/// <reference path="../pb_data/types.d.ts" />
// Phase 5: forfeit cron. Runs daily at 05:05 UTC (00:05 EST / 01:05 EDT) — always
// after ET midnight, and before the 12:00 UTC daily-email cron that recaps these
// results. Sweeps any pending/partial match whose ET calendar day is before today.
//
// The sweep logic lives in lib/forfeits.js (so it's testable and so the
// goja-incompatible bits — no Intl, no record.getId() — are fixed in one place;
// the old inline `new Intl.DateTimeFormat(...)` threw and the sweep never ran).
// PB isolated-scope gotcha: require() INSIDE the handler.
cronAdd("forfeits", "5 5 * * *", () => {
  const forfeits = require(`${__hooks}/lib/forfeits.js`);
  const r = forfeits.sweep($app); // defaults to today (ET)
  if (r.error) { console.error("forfeits: " + r.error); return; }
  console.log("forfeits: swept " + r.swept + " match(es) for " + r.today
    + (r.swept ? " — " + r.details.map((d) => d.id + ":" + d.result).join(", ") : ""));
});
