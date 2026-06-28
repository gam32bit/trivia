// Phase 5: forfeit cron hook.
// Runs daily at 05:05 UTC (00:05 EST / 01:05 EDT) — always after ET midnight.
// Sweeps any pending/partial match whose match_date calendar day is before today ET.
//
// If exactly one player submitted all 5 answers → they win (standings updated).
// The non-submitter gets a recorded loss (consistent with normal match scoring).
// If neither player submitted 5 answers → status=forfeit, no standings change.
//
// NOTE: PocketBase JSVM isolated-scope gotcha — all helpers are inline.
cronAdd("forfeits", "5 5 * * *", () => {
  const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  // All pending/partial matches (status filter excludes already-forfeited/complete rows,
  // preventing double-counting on re-runs).
  let allActive;
  try {
    allActive = $app.findAllRecords(
      "matches",
      $dbx.or(
        $dbx.hashExp({ "status": "pending" }),
        $dbx.hashExp({ "status": "partial" })
      )
    );
  } catch (err) {
    console.error("forfeits: failed to query matches:", String(err));
    return;
  }

  // Only matches whose calendar date (first 10 chars of stored string) is before today ET.
  // match_date is stored as "YYYY-MM-DD 00:00:00.000Z" where the date part is the ET calendar day.
  const stale = allActive.filter(m => m.getString("match_date").slice(0, 10) < todayET);

  if (stale.length === 0) {
    console.log("forfeits: nothing to sweep for " + todayET);
    return;
  }

  console.log("forfeits: sweeping " + stale.length + " match(es) for " + todayET);

  const applyResult = (season, playerId, result) => {
    let row = null;
    try {
      row = $app.findFirstRecordByFilter(
        "standings",
        "season = {:season} && player = {:player}",
        { season: season, player: playerId }
      );
    } catch (_) {
      row = null;
    }
    if (!row) {
      row = new Record($app.findCollectionByNameOrId("standings"));
      row.set("season", season);
      row.set("player", playerId);
      row.set("wins", 0);
      row.set("ties", 0);
      row.set("losses", 0);
      row.set("points", 0);
    }
    if (result === "win") {
      row.set("wins", row.getInt("wins") + 1);
      row.set("points", row.getInt("points") + 2);
    } else {
      row.set("losses", row.getInt("losses") + 1);
    }
    $app.save(row);
  };

  for (const match of stale) {
    const matchId = match.getId();
    const playerA = match.getString("player_a");
    const playerB = match.getString("player_b");
    const season = match.getInt("season");
    const matchDate = match.getString("match_date").slice(0, 10);

    let answers = [];
    try {
      answers = $app.findAllRecords("answers", $dbx.hashExp({ "match": matchId }));
    } catch (_) {}

    const counts = {};
    for (const a of answers) {
      const pid = a.getString("player");
      counts[pid] = (counts[pid] || 0) + 1;
    }

    const aDone = (counts[playerA] || 0) >= 5;
    const bDone = (counts[playerB] || 0) >= 5;

    match.set("status", "forfeit");

    if (aDone && !bDone) {
      match.set("winner", playerA);
      $app.save(match);
      applyResult(season, playerA, "win");
      applyResult(season, playerB, "loss");
      console.log("forfeits: " + matchDate + " match " + matchId + " → A wins by forfeit");
    } else if (bDone && !aDone) {
      match.set("winner", playerB);
      $app.save(match);
      applyResult(season, playerB, "win");
      applyResult(season, playerA, "loss");
      console.log("forfeits: " + matchDate + " match " + matchId + " → B wins by forfeit");
    } else {
      // Neither (or both, theoretically impossible) completed — no standings change.
      match.set("winner", "");
      $app.save(match);
      console.log("forfeits: " + matchDate + " match " + matchId + " → forfeit, no winner (A=" + (counts[playerA] || 0) + " B=" + (counts[playerB] || 0) + ")");
    }
  }
});
