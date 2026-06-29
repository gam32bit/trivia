/// <reference path="../pb_data/types.d.ts" />
//
// Daily season emails (Lose'd League). Two handlers:
//   1. cronAdd  — every morning at 8:00am ET, send the day's email to all 4.
//   2. routerAdd — superuser-only preview/test route (render HTML or send-to-self),
//      so copy can be proofed before the cron ever mails the friends.
//
// PB JSVM isolated-scope gotcha (see project memory): handler bodies CANNOT see
// file top-level vars, and a top-level require() result is invisible inside a
// handler. So each handler require()s the shared renderer as its FIRST line.
// All rendering/data-gathering lives in lib/email.js (pure, takes $app); this
// file owns scheduling, idempotency (email_log) and actually sending.

const PROD_URL = "https://trivia.jwcaterine.com";

// --- 1. daily cron: 8:00am ET (0 12 UTC during EDT; after the 05:05 UTC
//        forfeit sweep so "yesterday's results" are already finalized). ---
cronAdd("daily-email", "0 12 * * *", () => {
  const email = require(`${__hooks}/lib/email.js`);
  const r = email.runDaily($app, email.todayET(), { siteUrl: PROD_URL });
  if (r.skipped) { console.log("daily-email: skipped (" + r.reason + ")"); return; }
  console.log("daily-email: " + r.type + " sent to " + r.sent + "/" + r.recipients
    + (r.errors && r.errors.length ? " (errors: " + r.errors.join("; ") + ")" : ""));
});

// --- 2. superuser-only preview/test route ---
// POST /api/admin/preview-daily-email?date=YYYY-MM-DD&recipient=<id|email|name|index>&mode=html|send-admin&siteUrl=...
// Never reads or writes email_log. mode=html returns the rendered HTML;
// mode=send-admin emails the whole rendered set to the authed superuser only.
routerAdd("POST", "/api/admin/preview-daily-email", (e) => {
 try {
  const email = require(`${__hooks}/lib/email.js`);
  const ri = e.requestInfo();
  const param = (k) => (ri.query && ri.query[k]) || (ri.body && ri.body[k]) || "";

  const date = param("date") || email.todayET();
  const mode = param("mode") || "html";
  const siteUrl = param("siteUrl") || PROD_URL;

  const result = email.prepare($app, date, { siteUrl: siteUrl });
  if (result.type === "none") {
    return e.json(200, { type: "none", reason: result.reason, date: date });
  }

  // pick one recipient for html mode
  const sel = String(param("recipient") || "").toLowerCase();
  let recipient = result.recipients[0];
  if (sel) {
    const idx = parseInt(sel, 10);
    recipient = result.recipients.find((r) =>
      r.id.toLowerCase() === sel ||
      (r.email || "").toLowerCase() === sel ||
      (r.name || "").toLowerCase() === sel
    ) || (Number.isInteger(idx) && result.recipients[idx]) || result.recipients[0];
  }

  if (mode === "html") {
    return e.html(200, recipient.html);
  }

  if (mode === "send-admin") {
    const adminAddr = e.auth ? e.auth.getString("email") : "";
    if (!adminAddr) return e.json(400, { error: "no superuser email on auth record" });
    const mailer = $app.newMailClient();
    const from = { address: $app.settings().meta.senderAddress, name: $app.settings().meta.senderName };
    const results = [];
    for (const r of result.recipients) {
      try {
        mailer.send(new MailerMessage({
          from: from,
          to: [{ address: adminAddr }],
          subject: "[PREVIEW→" + r.name + "] " + r.subject,
          html: r.html,
        }));
        results.push({ for: r.name, sent: true });
      } catch (err) {
        results.push({ for: r.name, sent: false, error: String(err) });
      }
    }
    return e.json(200, { type: result.type, date: date, sentTo: adminAddr, results: results });
  }

  return e.json(400, { error: "unknown mode (use html or send-admin)" });
 } catch (err) {
  // superuser-only tool: surface render errors directly to ease copy iteration
  return e.json(500, { error: String(err), stack: (err && err.stack) ? String(err.stack) : "" });
 }
}, $apis.requireSuperuserAuth());

// --- 3. Fire on server startup so a fresh deploy sends today's email immediately
//        rather than waiting for the 8am ET cron. email_log idempotency means
//        this is safe across restarts. ---
$app.onServe().add(function(e) {
  const email = require(`${__hooks}/lib/email.js`);
  const r = email.runDaily($app, email.todayET(), { siteUrl: PROD_URL });
  if (r.skipped) { console.log("startup-email: skipped (" + r.reason + ")"); }
  else { console.log("startup-email: " + r.type + " sent to " + r.sent + "/" + r.recipients
    + (r.errors && r.errors.length ? " (errors: " + r.errors.join("; ") + ")" : "")); }
  e.next();
});
