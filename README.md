# Trivia League

A private, asynchronous, daily-cadence trivia game for four friends. See `PLAN.md` for the full spec.

## Quick start (local development)

```bash
# Start PocketBase
cd pb && ./pocketbase serve --http 127.0.0.1:8090

# First run: create the admin account
./pocketbase superuser upsert admin@example.com yourpassword

# Import questions (requires trivia.db — run pull_trivia.py first if needed)
python3 scripts/import_questions.py --db trivia.db --pb http://localhost:8090

# Generate a season
python3 scripts/generate_season.py --season 1 --start-date 2026-06-01 --cycles 4
```

## Setup notes

- Create four player accounts via the PocketBase admin UI at `http://localhost:8090/_/`
- `trivia.db` is gitignored; run `python3 pull_trivia.py` to build the local question pool
- See `PLAN.md` → Deployment appendix for VPS setup

## Web app

The front end is static files in `web/` (no build step). Open `web/index.html`
in a browser; it talks to PocketBase at `http://localhost:8090`. Logged in as a
player you can:

- **Play today's match** — three multiple-choice questions, one at a time.
- **See results** once both players have submitted — a per-question breakdown
  with both players' answers, the correct answer, and a win/tie/loss banner.
  (You can't see your opponent's answers until the match is complete.)
- **Leaderboard** — the current season ranked by points (W/T/L/points).
- **Profile** — upload a profile photo + a victory photo, and set a default
  taunt. Winners can post a taunt on a completed match's results.

In production the frontend talks to PocketBase on the same origin; in local dev
(opened from `file://` or `localhost`) it falls back to `http://localhost:8090`.

Scoring is authoritative and server-side: `pb/pb_hooks/scoring.pb.js` advances a
match `partial → complete` when the second player finishes, sets the `winner`,
and upserts `standings` (win = 2 pts, tie = 1 pt each, loss = 0).
`pb/pb_hooks/matches_guard.pb.js` ensures players can only ever write
`a_taunt`/`b_taunt` on a match — never `winner`/`status` — so scoring can't be
forged from the client.

## Deployment

Production runs on a self-managed VPS at **https://trivia.jwcaterine.com**
(PocketBase serves the static frontend, the API, and its own Let's Encrypt TLS).
See `PLAN.md` → Deployment appendix for the one-time server provisioning.

To push code changes (hooks, migrations, frontend) after the server exists:

```bash
scripts/deploy.sh          # rsyncs pb_hooks/, pb_migrations/, web/ and restarts
```

Migrations apply automatically on restart. The script never touches `pb_data/`.
