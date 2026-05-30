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
