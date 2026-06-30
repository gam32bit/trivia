/// <reference path="../../pb_data/types.d.ts" />
//
// Shared renderer + data-gathering for the daily season emails (Lose'd League).
//
// These are PURE functions: they READ via the passed-in `$app` and return
// strings/plain data. They never write records or send mail — the daily_email
// hook owns idempotency (email_log) and sending. This module is required INSIDE
// each handler (PB JSVM isolated-scope gotcha — see project memory):
//     const email = require(`${__hooks}/lib/email.js`);
//
// Entry point: prepare($app, today, opts) → { type, season, prevDate, prevRound,
//   recipients: [{ id, email, name, subject, html }], reason }
//   type ∈ "welcome" | "daily" | "finale" | "none".
//
// ====================================================================
// COPY — edit the strings in this block to change tone/wording. The
// STRUCTURE mirrors the real Learned League recap email (results available →
// your result + score → standings position + W-L-T record → sign-off →
// automated-email disclaimer); the TONE is the requested over-the-top
// praise / tongue-in-cheek shame. TODO: set COMMISSIONER once chosen.
// ====================================================================
const LEAGUE = "Lose'd League";
const COMMISSIONER = "Thirsten";

// Personalized header blurb for the recipient's own result.
function praiseBlurb(oppName, myScore, oppScore) {
  return `<p style="margin:0 0 12px">Wow. Guess you&rsquo;re not as much of a loser as I thought you were. You took a big ol&rsquo; dump on ${oppName}, and I think they liked it? Doubt you&rsquo;ll keep it up tho.</p>`;
}
function shameBlurb(oppName, myScore, oppScore) {
  return `<p style="margin:0 0 12px">Saw that one coming LOSER! ${oppName} beat your ass!!!! You fucking dumb piece of shit&hellip;</p>`;
}
function tieBlurb(oppName, myScore, oppScore) {
  return `<p style="margin:0 0 12px">Congrats you got the most boring result - you and ${oppName} tied. Boring. BORING BORING BORING BORING BORING BORING BORING BORING BORING BORING</p>`;
}

// ---------- date (ET, Intl-free) ----------
// goja (PB's JS engine) has NO Intl, so we can't use Intl.DateTimeFormat for the
// America/New_York calendar day. Compute the US-Eastern offset by the standard
// DST rule (2nd Sun Mar 02:00 → 1st Sun Nov 02:00) and shift UTC accordingly.
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
  const offsetH = (now >= dstStart && now < dstEnd) ? 4 : 5; // EDT : EST
  return new Date(now.getTime() - offsetH * 3600 * 1000).toISOString().slice(0, 10);
}

// ---------- small helpers ----------
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fileUrl(siteUrl, userId, filename) {
  return `${siteUrl}/api/files/users/${userId}/${encodeURIComponent(filename)}`;
}
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function dayOf(match) {
  return match.getString("match_date").slice(0, 10);
}
function isFinal(match) {
  const s = match.getString("status");
  return s === "complete" || s === "forfeit";
}

// Correct-answer counts per player id for a match → { playerId: count }.
function scoreMatch($app, match) {
  const by = {};
  let ans = [];
  try {
    ans = $app.findRecordsByFilter("answers", "match = {:m}", "", 0, 0, { m: match.getString("id") });
  } catch (_) { ans = []; }
  for (const a of ans) {
    if (a && a.getBool("is_correct")) {
      const p = a.getString("player");
      by[p] = (by[p] || 0) + 1;
    }
  }
  return by;
}

// Outcome of a final match from a player's perspective: win | loss | tie.
function outcomeFor(match, meId) {
  const w = match.getString("winner");
  if (w === meId) return "win";
  if (w) return "loss";
  return "tie";
}

// ---------- standings ----------
// Returns rows [{id,name,wins,ties,losses,points}] sorted points↓ wins↓ name↑
// (identical ordering to web/app.js:495), left-joined so 0-row players show.
function computeStandings($app, season, users) {
  let rows = [];
  try {
    rows = $app.findRecordsByFilter("standings", "season = {:s}", "", 0, 0, { s: season });
  } catch (_) { rows = []; }
  const byPlayer = {};
  for (const r of rows) if (r) byPlayer[r.getString("player")] = r;
  const out = users.map((u) => {
    const s = byPlayer[u.getString("id")];
    return {
      id: u.getString("id"),
      name: u.getString("display_name"),
      wins: s ? s.getInt("wins") : 0,
      ties: s ? s.getInt("ties") : 0,
      losses: s ? s.getInt("losses") : 0,
      points: s ? s.getInt("points") : 0,
    };
  });
  out.sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
  return out;
}

function renderStandingsTable(rows, meId) {
  const body = rows.map((r, i) => {
    const me = r.id === meId;
    const bg = me ? "background:#fff3cd;" : (i % 2 ? "background:#fafafa;" : "");
    const nm = esc(r.name) + (me ? " <span style=\"color:#b8860b\">(you)</span>" : "");
    return `<tr style="${bg}">
      <td style="padding:6px 10px;text-align:center;color:#888">${i + 1}</td>
      <td style="padding:6px 10px;font-weight:${me ? 700 : 400}">${nm}</td>
      <td style="padding:6px 10px;text-align:center">${r.wins}</td>
      <td style="padding:6px 10px;text-align:center">${r.ties}</td>
      <td style="padding:6px 10px;text-align:center">${r.losses}</td>
      <td style="padding:6px 10px;text-align:center;font-weight:700">${r.points}</td>
    </tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"
      style="border-collapse:collapse;font-size:14px;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden">
    <thead><tr style="background:#1a1a2e;color:#fff">
      <th style="padding:8px 10px;text-align:center">#</th>
      <th style="padding:8px 10px;text-align:left">Player</th>
      <th style="padding:8px 10px;text-align:center">W</th>
      <th style="padding:8px 10px;text-align:center">T</th>
      <th style="padding:8px 10px;text-align:center">L</th>
      <th style="padding:8px 10px;text-align:center">Pts</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

// LL-style standing line: "You're currently 3rd of 4, at 8-4-2 (W-L-T)."
function standingLine(standingsRows, meId) {
  const idx = standingsRows.findIndex((r) => r.id === meId);
  if (idx < 0) return "";
  const r = standingsRows[idx];
  return `<p style="margin:8px 0 0;font-size:14px;color:#555">You&rsquo;re currently <strong>${ordinal(idx + 1)} of ${standingsRows.length}</strong>, at ${r.wins}&ndash;${r.losses}&ndash;${r.ties} (W&ndash;L&ndash;T).</p>`;
}

// ---------- result blocks ----------
// The recipient's OWN result for prevMatches — the personalized praise/shame.
function renderResultBlock($app, myMatch, meId, usersById, siteUrl) {
  if (!myMatch) return "";
  const date = dayOf(myMatch);
  if (!isFinal(myMatch)) {
    return card(`Your match`, `<p style="margin:0">Your match from ${esc(date)} hasn&rsquo;t been settled yet. Lucky you.</p>`);
  }
  const aId = myMatch.getString("player_a");
  const bId = myMatch.getString("player_b");
  const oppId = aId === meId ? bId : aId;
  const opp = usersById[oppId];
  const oppName = esc(opp ? opp.getString("display_name") : "your opponent");
  const by = scoreMatch($app, myMatch);
  const myScore = by[meId] || 0;
  const oppScore = by[oppId] || 0;
  const oc = outcomeFor(myMatch, meId);

  let inner = "";
  if (oc === "win") {
    inner = praiseBlurb(oppName, myScore, oppScore);
  } else if (oc === "tie") {
    inner = tieBlurb(oppName, myScore, oppScore);
  } else {
    // loss — embed the victor's gloat (loser-only reveal), with empty-state fallback
    inner = shameBlurb(oppName, myScore, oppScore);
    const taunt = opp ? opp.getString("taunt_signature") : "";
    const vpic = opp ? opp.getString("victory_pic") : "";
    const audio = opp ? opp.getString("taunt_audio") : "";
    if (vpic || taunt || audio) {
      let gloat = `<div style="margin-top:8px;padding:12px;border-left:4px solid #c0392b;background:#fdecea">`;
      gloat += `<div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#c0392b;margin-bottom:6px">${oppName} would like a word</div>`;
      if (vpic) {
        gloat += `<img src="${fileUrl(siteUrl, oppId, vpic)}" alt="${oppName}'s victory" width="180" style="max-width:100%;border-radius:8px;display:block;margin:0 0 8px">`;
      }
      if (taunt) {
        gloat += `<p style="margin:0;font-style:italic;font-size:15px">&ldquo;${esc(taunt)}&rdquo;</p>`;
      }
      if (audio) {
        gloat += `<p style="margin:8px 0 0;font-size:13px"><a href="${fileUrl(siteUrl, oppId, audio)}" style="color:#c0392b">&#9654; Hear them say it out loud</a></p>`;
      }
      gloat += `</div>`;
      inner += gloat;
    }
  }
  return card(`Your result`, inner);
}

// Both of the day's matches, stated neutrally (the full-league recap).
function renderLeagueResults($app, prevMatches, usersById) {
  const lines = prevMatches.map((m) => {
    const aId = m.getString("player_a"), bId = m.getString("player_b");
    const aN = esc(usersById[aId] ? usersById[aId].getString("display_name") : "?");
    const bN = esc(usersById[bId] ? usersById[bId].getString("display_name") : "?");
    if (!isFinal(m)) return `<li style="margin:4px 0;color:#888">${aN} vs ${bN} &mdash; not yet decided</li>`;
    const by = scoreMatch($app, m);
    const aS = by[aId] || 0, bS = by[bId] || 0;
    const w = m.getString("winner");
    if (!w) return `<li style="margin:4px 0">${aN} <strong>${aS}&ndash;${bS}</strong> ${bN} &mdash; tie</li>`;
    const wN = w === aId ? aN : bN, lN = w === aId ? bN : aN;
    const hi = Math.max(aS, bS), lo = Math.min(aS, bS);
    return `<li style="margin:4px 0"><strong>${wN}</strong> def. ${lN} ${hi}&ndash;${lo}</li>`;
  }).join("");
  return card(`The full slate`, `<ul style="margin:0;padding-left:18px;font-size:14px">${lines}</ul>`);
}

// Today's matchup + a button to go play it.
function renderTodayBlock(todayMatch, meId, usersById, siteUrl) {
  if (!todayMatch) return "";
  const aId = todayMatch.getString("player_a"), bId = todayMatch.getString("player_b");
  const oppId = aId === meId ? bId : aId;
  const oppName = esc(usersById[oppId] ? usersById[oppId].getString("display_name") : "your opponent");
  const inner = `<p style="margin:0 0 14px">Today you face <strong>${oppName}</strong>. Don&rsquo;t think you&rsquo;re going to win, because you&rsquo;re a LOSER but we&rsquo;ll see.</p>
    <a href="${esc(siteUrl)}" style="display:inline-block;background:#1a1a2e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Play today&rsquo;s match &rarr;</a>`;
  return card(`Today&rsquo;s match`, inner);
}

// Welcome (day 1): how it works + profile how-to + today's match.
function renderWelcomeBody(user, todayMatch, meId, usersById, siteUrl) {
  const howItWorks = card(`How ${LEAGUE} works`, `
    <p style="margin:0 0 10px">Every weekday you get a match against one of the other three players: five trivia questions, answered whenever you like before the day is out. Get more right than your opponent and you win (2 pts). Tie and you each take 1.</p>
    <p style="margin:0">Miss a day entirely and it&rsquo;s scored a forfeit.</p>`);
  const profile = card(`Set up your profile`, `
    <p style="margin:0 0 10px">Log in and open your profile to make yourself known:</p>
    <ul style="margin:0 0 10px;padding-left:18px;font-size:14px">
      <li style="margin:4px 0"><strong>Display name</strong> &mdash; what your loser ass wants to be called.</li>
      <li style="margin:4px 0"><strong>Profile picture</strong> &mdash; your loser ass face.</li>
      <li style="margin:4px 0"><strong>Victory picture</strong> &mdash; what you want other losers to see when you win.</li>
      <li style="margin:4px 0"><strong>Victory taunt</strong> &mdash; shove it in other losers&rsquo; faces.</li>
      <li style="margin:4px 0"><strong>Change your password</strong> &mdash; change your fucking password. The default one is your <strong>first name in lowercase followed by 1234</strong> (e.g. <code>${esc((user.getString("display_name") || "yourname").split(/\s+/)[0].toLowerCase())}1234</code>).</li>
    </ul>`);
  return howItWorks + profile + renderTodayBlock(todayMatch, meId, usersById, siteUrl);
}

// ---------- layout ----------
function card(title, innerHtml) {
  return `<div style="background:#fff;border:1px solid #ececec;border-radius:12px;padding:18px 20px;margin:0 0 16px">
    <h2 style="margin:0 0 12px;font-size:16px;color:#1a1a2e">${title}</h2>
    ${innerHtml}
  </div>`;
}

function layout(preheader, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f7">
      <tr><td align="center" style="padding:24px 12px">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%">
          <tr><td style="padding:0 0 16px;text-align:center">
            <span style="font-size:22px;font-weight:800;letter-spacing:.5px;color:#1a1a2e">${LEAGUE}</span>
          </td></tr>
          <tr><td>${bodyHtml}</td></tr>
          <tr><td style="padding:8px 4px 0;color:#9a9a9a;font-size:12px;line-height:1.5">
            <p style="margin:0 0 6px">Yours in mild contempt,<br>${COMMISSIONER}</p>
            <p style="margin:0">This is an automated email, so replying to it accomplishes nothing &mdash; much like your defense on the questions you missed. There is no unsubscribe; you&rsquo;re in this league until the bitter end.</p>
          </td></tr>
        </table>
      </td></tr>
    </table></body></html>`;
}

// ---------- orchestration ----------
function prepare($app, today, opts) {
  opts = opts || {};
  const siteUrl = (opts.siteUrl || "https://trivia.jwcaterine.com").replace(/\/$/, "");

  // current season = highest real (>= 0) season among matches
  let top = [];
  try { top = $app.findRecordsByFilter("matches", "season >= 0", "-season", 1, 0); } catch (_) {}
  if (!top.length) return { type: "none", reason: "no matches", recipients: [] };
  const season = top[0].getInt("season");

  const seasonMatches = $app.findRecordsByFilter("matches", "season = {:s}", "round", 0, 0, { s: season })
    .filter(Boolean);

  const todayMatches = seasonMatches.filter((m) => dayOf(m) === today);
  const priorDays = [...new Set(seasonMatches.filter((m) => dayOf(m) < today).map(dayOf))].sort();
  const prevDate = priorDays.length ? priorDays[priorDays.length - 1] : null;
  const prevMatches = prevDate ? seasonMatches.filter((m) => dayOf(m) === prevDate) : [];
  const allDays = [...new Set(seasonMatches.map(dayOf))].sort();
  const firstDate = allDays[0];
  const hasFuture = seasonMatches.some((m) => dayOf(m) > today);

  // forceWelcome lets runDaily catch up the welcome email when the feature is
  // deployed after the season's first match day (otherwise welcome — keyed by
  // exact firstDate — would silently never fire). It only sets this when a match
  // day exists, so today's-match content is always available.
  let type;
  if (opts.forceWelcome && todayMatches.length) type = "welcome";
  else if (todayMatches.length) type = (today === firstDate || !prevDate) ? "welcome" : "daily";
  else if (prevDate && !hasFuture) type = "finale";
  else type = "none";

  if (type === "none") {
    return { type, season, firstDate, reason: "no email scheduled for " + today, recipients: [] };
  }

  const users = $app.findAllRecords("users").filter(Boolean);
  const usersById = {};
  for (const u of users) usersById[u.getString("id")] = u;
  const standingsRows = computeStandings($app, season, users);
  const prevRound = prevMatches.length ? prevMatches[0].getInt("round") : null;

  const recipients = users.map((u) => {
    const uid = u.getString("id");
    const name = u.getString("display_name");
    const myToday = todayMatches.find((m) => m.getString("player_a") === uid || m.getString("player_b") === uid);
    const myPrev = prevMatches.find((m) => m.getString("player_a") === uid || m.getString("player_b") === uid);

    let body = "", subject = "";
    if (type === "welcome") {
      subject = `Welcome to ${LEAGUE} — Season ${season} begins`;
      body = `<div style="background:#fff;border:1px solid #ececec;border-radius:12px;padding:18px 20px;margin:0 0 16px">
          <p style="margin:0;font-size:15px">Welcome, ${esc(name)}. A new season of ${LEAGUE} starts today, and with it a fresh chance to disappoint yourself daily. Here&rsquo;s everything you need.</p>
        </div>`
        + renderWelcomeBody(u, myToday, uid, usersById, siteUrl)
        + card(`Standings`, renderStandingsTable(standingsRows, uid));
    } else if (type === "daily") {
      subject = `${LEAGUE} S${season} — Match Day ${prevRound} results & today's match`;
      body = `<div style="background:#fff;border:1px solid #ececec;border-radius:12px;padding:18px 20px;margin:0 0 16px">
          <p style="margin:0;font-size:15px">The results for ${LEAGUE} Season ${season} Match Day ${prevRound} are in, ${esc(name)}.</p>
          ${standingLine(standingsRows, uid)}
        </div>`
        + renderResultBlock($app, myPrev, uid, usersById, siteUrl)
        + renderLeagueResults($app, prevMatches, usersById)
        + card(`Standings`, renderStandingsTable(standingsRows, uid))
        + renderTodayBlock(myToday, uid, usersById, siteUrl);
    } else {
      // finale
      subject = `${LEAGUE} S${season} — that's a wrap`;
      body = `<div style="background:#fff;border:1px solid #ececec;border-radius:12px;padding:18px 20px;margin:0 0 16px">
          <p style="margin:0;font-size:15px">That&rsquo;s the season, ${esc(name)}. The final Match Day ${prevRound} results are below &mdash; and then we crown someone.</p>
          ${standingLine(standingsRows, uid)}
        </div>`
        + renderResultBlock($app, myPrev, uid, usersById, siteUrl)
        + renderLeagueResults($app, prevMatches, usersById)
        + card(`Season ${season} is over`,
            renderFinaleCrown(standingsRows, uid, season))
        + card(`Final standings`, renderStandingsTable(standingsRows, uid));
    }

    const html = layout(subject, body);
    return { id: uid, email: u.getString("email"), name, subject, html };
  });

  return { type, season, firstDate, prevDate, prevRound, recipients };
}

// champion/co-champion blurb (split out so finale standings table is separate)
function renderFinaleCrown(standingsRows, meId, season) {
  const top = standingsRows[0];
  const champs = standingsRows.filter((r) => r.points === top.points && r.wins === top.wins);
  if (champs.length > 1) {
    const names = champs.map((c) => esc(c.name)).join(" &amp; ");
    return `<p style="margin:0 0 8px;font-size:18px">&#127942; <strong>Co-champions: ${names}</strong></p>
      <p style="margin:0">A tie at the very top &mdash; they share the throne. How dignified.</p>`;
  }
  const champ = champs[0];
  const youWon = champ.id === meId;
  return `<p style="margin:0 0 8px;font-size:18px">&#127942; <strong>Champion: ${esc(champ.name)}</strong></p>`
    + (youWon
      ? `<p style="margin:0">That&rsquo;s <strong>you</strong>. You out-trivia&rsquo;d the entire field and we will never hear the end of it. Deservedly so.</p>`
      : `<p style="margin:0">${esc(champ.name)} takes the season. You&rsquo;ll get them next time. Probably not, but it&rsquo;s nice to say.</p>`);
}

// Full daily run: idempotency guards + send + email_log write. Used by the cron
// (dryRun=false) and exercisable from a test route. Returns a summary; never
// throws on a single send failure (best-effort).
function runDaily($app, today, opts) {
  opts = opts || {};
  const siteUrl = opts.siteUrl || "https://trivia.jwcaterine.com";
  const dryRun = !!opts.dryRun;

  // one batch per calendar day (covers restart + manual + cron)
  let already = null;
  try { already = $app.findFirstRecordByFilter("email_log", "send_date = {:d}", { d: today }); } catch (_) {}
  if (already) return { skipped: true, reason: "already sent for " + today, type: already.getString("email_type") };

  let result = prepare($app, today, { siteUrl: siteUrl });
  if (result.type === "none") return { skipped: true, reason: result.reason, type: "none" };

  // Welcome catch-up: the onboarding email is the headline deliverable, but if
  // the feature is deployed after the season's first match day, a normal match
  // morning resolves to "daily". On the first match morning with no welcome yet
  // sent this season, send welcome instead (welcome-only; recap resumes next day).
  if (result.type === "daily") {
    let welcomeSent = null;
    try { welcomeSent = $app.findFirstRecordByFilter("email_log", "email_type = 'welcome' && season = {:s}", { s: result.season }); } catch (_) {}
    if (!welcomeSent) result = prepare($app, today, { siteUrl: siteUrl, forceWelcome: true });
  }

  // finale must fire only once per season (later no-match mornings would re-trigger)
  if (result.type === "finale") {
    let fin = null;
    try { fin = $app.findFirstRecordByFilter("email_log", "email_type = 'finale' && season = {:s}", { s: result.season }); } catch (_) {}
    if (fin) return { skipped: true, reason: "finale already sent for season " + result.season, type: "finale" };
  }

  let sent = 0;
  const errors = [];
  if (!dryRun) {
    const mailer = $app.newMailClient();
    const from = { address: $app.settings().meta.senderAddress, name: $app.settings().meta.senderName };
    for (const r of result.recipients) {
      if (!r.email) continue;
      try {
        mailer.send(new MailerMessage({ from: from, to: [{ address: r.email }], subject: r.subject, html: r.html }));
        sent++;
      } catch (err) {
        errors.push(r.email + ": " + String(err)); // best-effort: keep going
      }
    }
  }

  // idempotency marker — written only when at least one email actually went out.
  // A partial failure still marks the day done (so we never re-spam the ones who
  // got it), but a TOTAL failure (e.g. SMTP misconfigured on the first run) does
  // NOT mark it, leaving the day retryable by a same-day restart/manual trigger.
  let logged = false;
  if (!dryRun && sent > 0) {
    try {
      const rec = new Record($app.findCollectionByNameOrId("email_log"));
      rec.set("send_date", today);
      rec.set("email_type", result.type);
      rec.set("season", result.season);
      $app.save(rec);
      logged = true;
    } catch (err) {
      errors.push("email_log write: " + String(err));
    }
  }

  return { skipped: false, type: result.type, season: result.season, recipients: result.recipients.length, sent: sent, logged: logged, errors: errors, dryRun: dryRun };
}

module.exports = { prepare, runDaily, todayET };
