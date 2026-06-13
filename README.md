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

Scoring is authoritative and server-side: `pb/pb_hooks/scoring.pb.js` advances a
match `partial → complete` when the second player finishes, sets the `winner`,
and upserts `standings` (win = 2 pts, tie = 1 pt each, loss = 0).
