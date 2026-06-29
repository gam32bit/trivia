/// <reference path="../../pb_data/types.d.ts" />
//
// Forfeit sweep (extracted from the forfeits cron so it's testable and so the
// goja-incompatible bits are fixed in one place). Pure-ish: reads/writes via the
// passed-in $app, returns a summary. Self-contained (no cross-module require) so
// this critical hook can't be taken down by an unrelated module failing to load.
//
// FIXES vs the old inline cron (both verified against this PB v0.39 / goja build):
//   - goja has NO Intl, so todayET is computed with explicit US-Eastern DST math
//     (the old `new Intl.DateTimeFormat(...)` threw "Intl is not defined" and the
//     sweep never ran).
//   - record id via getString("id"); `getId()` is not bound on records here.
// NOTE: todayET is duplicated from lib/email.js on purpose — keeping this hook
// dependency-free is worth ~10 lines. Keep the two copies in sync.

function nthSundayUTC(year, monthIndex, n, utcHour) {
  const first = new Date(Date.UTC(year, monthIndex, 1, utcHour, 0, 0));
  const firstSunday = 1 + ((7 - first.getUTCDay()) % 7);
  return new Date(Date.UTC(year, monthIndex, firstSunday + (n - 1) * 7, utcHour, 0, 0));
}
function todayET(now) {
  now = now || new Date();
  const y = now.getUTCFullYear();
  const dstStart = nthSundayUTC(y, 2, 2, 7);  // 2nd Sun Mar, 02:00 EST = 07:00 UTC
  const dstEnd = nthSundayUTC(y, 10, 1, 6);   // 1st Sun Nov, 02:00 EDT = 06:00 UTC
  const offsetH = (now >= dstStart && now < dstEnd) ? 4 : 5;
  return new Date(now.getTime() - offsetH * 3600 * 1000).toISOString().slice(0, 10);
}

// Sweep every pending/partial match whose ET calendar day is before `today`.
// One submitter (5 answers) → they win; the no-show takes a loss. Neither → a
// pure forfeit with no winner / no standings change. Idempotent: the status
// filter excludes already-forfeited/complete rows.
function sweep($app, today) {
  today = today || todayET();

  const applyResult = (season, playerId, result) => {
    let row = null;
    try {
      row = $app.findFirstRecordByFilter(
        "standings", "season = {:season} && player = {:player}",
        { season: season, player: playerId });
    } catch (_) { row = null; }
    if (!row) {
      row = new Record($app.findCollectionByNameOrId("standings"));
      row.set("season", season);
      row.set("player", playerId);
      row.set("wins", 0); row.set("ties", 0); row.set("losses", 0); row.set("points", 0);
    }
    if (result === "win") {
      row.set("wins", row.getInt("wins") + 1);
      row.set("points", row.getInt("points") + 2);
    } else {
      row.set("losses", row.getInt("losses") + 1);
    }
    $app.save(row);
  };

  let active;
  try {
    active = $app.findAllRecords("matches",
      $dbx.or($dbx.hashExp({ "status": "pending" }), $dbx.hashExp({ "status": "partial" })));
  } catch (err) {
    return { error: "query failed: " + String(err), swept: 0 };
  }

  const stale = (active || []).filter((m) => m && m.getString("match_date").slice(0, 10) < today);
  const swept = [];

  for (const match of stale) {
    const matchId = match.getString("id");
    const playerA = match.getString("player_a");
    const playerB = match.getString("player_b");
    const season = match.getInt("season");

    let answers = [];
    try { answers = $app.findRecordsByFilter("answers", "match = {:m}", "", 0, 0, { m: matchId }); } catch (_) {}
    const counts = {};
    for (const a of answers) if (a) { const p = a.getString("player"); counts[p] = (counts[p] || 0) + 1; }
    const aDone = (counts[playerA] || 0) >= 5;
    const bDone = (counts[playerB] || 0) >= 5;

    match.set("status", "forfeit");
    if (aDone && !bDone) {
      match.set("winner", playerA); $app.save(match);
      applyResult(season, playerA, "win"); applyResult(season, playerB, "loss");
      swept.push({ id: matchId, result: "A wins by forfeit" });
    } else if (bDone && !aDone) {
      match.set("winner", playerB); $app.save(match);
      applyResult(season, playerB, "win"); applyResult(season, playerA, "loss");
      swept.push({ id: matchId, result: "B wins by forfeit" });
    } else {
      match.set("winner", ""); $app.save(match);
      swept.push({ id: matchId, result: "no-contest forfeit" });
    }
  }

  return { today: today, swept: swept.length, details: swept };
}

module.exports = { sweep, todayET };
