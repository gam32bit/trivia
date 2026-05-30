# Trivia League — Build Plan

A private, asynchronous, daily-cadence trivia game for four friends. Modeled on
LearnedLeague: each weekday two players are paired, both answer the same three
questions on their own time, and whoever gets more right wins the day. Points
accumulate on a season leaderboard. The fun layer (avatars, trash talk, win
animations) is deferred to a later phase but the data model anticipates it.

This document is the working spec. Locked decisions are called out as such; if
you (the agent) think a locked decision should change, surface it for human
review rather than silently substituting an alternative.

---

## Locked architecture decisions

- **Backend:** PocketBase (single Go binary, SQLite, built-in auth, JS hooks).
  Not Supabase, not a hand-rolled Flask/FastAPI service. Reason: self-contained,
  self-hostable, no SaaS dependency for a tiny private game.
- **Frontend:** Vanilla HTML/CSS/JS served as static files. No npm, no bundler,
  no React/Vue/Svelte, no CSS framework. The author has prior experience
  shipping a vanilla-JS PWA and prefers no-build workflows. If a small utility
  library helps (e.g. PocketBase JS SDK loaded from a CDN), that's fine.
- **Questions:** Bulk-pulled once from Open Trivia DB via `pull_trivia.py`
  (already in the repo) into a local `trivia.db` SQLite file, then imported
  into PocketBase. No live OpenTDB calls at game time.
- **Players:** Exactly four. Accounts are created manually by the admin via the
  PocketBase admin UI. No public signup flow.
- **Scoring:** Win = 2 pts, tie = 1 pt each, loss = 0 pts. No negative points.
  Scoring is computed server-side in a PocketBase JS hook when the second
  player's answers land for a match. Clients never compute authoritative scores.
- **Match format:** 3 multiple-choice questions per match. Free-text answers are
  out of scope for v1.
- **Season length:** 4 cycles per season, where one cycle = one full round-robin
  (3 weekdays × 2 matches/day = 6 matches). A full season is 12 weekdays / 24
  matches; each player faces each opponent exactly 4 times.
- **Time zone:** `America/New_York` everywhere. All match dates, cutoffs, and
  scheduled hooks operate in Eastern time. If you find yourself reaching for
  UTC in user-facing logic, you're probably making a mistake — keep UTC for
  internal storage if you must, but render and reason in ET.
- **Daily cutoff:** Midnight Eastern. A match for date D is open from 00:00 ET
  on D through 23:59:59 ET on D. After that, the forfeit hook (Phase 5)
  resolves it.
- **Hosting:** Single VPS, self-managed. Hetzner CAX11 (€4/mo ARM, recommended)
  or CPX11 (€5/mo x86) is the default target; DigitalOcean's $6 droplet is the
  US-based fallback. See the Deployment appendix.

---

## Target repo layout

```
trivia-league/
├── PLAN.md                     # this file
├── README.md                   # short, for humans; agent maintains as features land
├── pull_trivia.py              # ALREADY PRESENT — do not modify
├── trivia.db                   # generated locally, gitignored
├── .gitignore
├── pb/
│   ├── pocketbase              # binary, gitignored
│   ├── pb_data/                # data dir, gitignored
│   ├── pb_hooks/               # committed
│   │   └── scoring.pb.js
│   └── pb_migrations/          # committed (PocketBase auto-generates these)
├── scripts/
│   ├── import_questions.py     # trivia.db -> PocketBase
│   └── generate_season.py      # creates matches + assigns questions
└── web/
    ├── index.html
    ├── app.js
    └── style.css
```

Anything outside this layout needs a justification in the PR description.

---

## Data model

PocketBase collections. Field types use PocketBase's terminology. Reasonable
required/optional defaults assumed unless noted.

### `users` (extends built-in auth collection)
- `display_name` — text, required
- `avatar_key` — text, optional (string key for a preset; file uploads deferred)
- `taunt_signature` — text, optional (default trash-talk line, used later)

### `questions`
- `otdb_id` — text, **unique index**, required (OpenTDB SHA-1 hash)
- `category` — text, required
- `difficulty` — select: `easy` / `medium` / `hard`
- `type` — select: `multiple` / `boolean`
- `text` — text, required (question prompt)
- `correct_answer` — text, required
- `incorrect_answers` — json (array of strings)
- `used_in_round` — number, optional (NULL until consumed by a match)

### `matches`
- `season` — number, required
- `round` — number, required (day number within season, 1-indexed)
- `match_date` — date, required
- `player_a` — relation → users, required
- `player_b` — relation → users, required
- `questions` — json (array of three question ids; not a relation field, to
  keep the order stable and the row self-contained)
- `status` — select: `pending` / `partial` / `complete` / `forfeit`
- `winner` — relation → users, optional (NULL on tie or pre-completion)
- `a_taunt` — text, optional (Phase 4)
- `b_taunt` — text, optional (Phase 4)
- `winner_animation` — text, optional (Phase 4 — preset key)

### `answers`
- `match` — relation → matches, required
- `player` — relation → users, required
- `question` — relation → questions, required
- `response` — text, required (the answer string the player selected)
- `is_correct` — bool, required
- `submitted_at` — date, required (autoset)
- Composite uniqueness: `(match, player, question)` must be unique.

### `standings`
- `season` — number, required
- `player` — relation → users, required
- `wins` — number, default 0
- `ties` — number, default 0
- `losses` — number, default 0
- `points` — number, default 0
- Composite uniqueness: `(season, player)` must be unique.

### Access rules (PocketBase rules expressions)
- `users`: read = anyone authenticated, write = only the record owner or admin.
- `questions`: read = authenticated, write = admin only.
- `matches`: read = authenticated AND user is player_a OR player_b; write = admin / hook only.
- `answers`: create = authenticated AND `player = @request.auth.id` AND match.status != `complete`;
  read = authenticated AND (user is player_a OR player_b of the related match) — but only after
  the match status is `complete` (i.e. you can't peek at your opponent's answers until both have submitted);
  update/delete = admin only.
- `standings`: read = authenticated, write = admin / hook only.

Note the read rule on `answers` — this is the load-bearing privacy guarantee.
Players must not be able to see each other's responses before both have
submitted, or the daily ritual collapses.

---

## Phases

Each phase produces something testable. Do not start the next phase until the
acceptance criteria of the current one are met. Commit after each acceptance
criterion is satisfied, with a message naming the criterion.

### Phase 1 — Data foundation (no UI)

**Scope:**
1. PocketBase running locally on `:8090` with all collections above created.
   Use migrations (PocketBase generates them) so the schema is reproducible.
2. `scripts/import_questions.py` reads `trivia.db` and upserts into the
   PocketBase `questions` collection via the JS SDK or REST API. Idempotent —
   re-running adds new questions only, never duplicates. Uses `otdb_id` as the
   dedupe key.
3. `scripts/generate_season.py` creates a season: takes `--season N`,
   `--start-date YYYY-MM-DD`, `--cycles K` (**default 4**, per locked
   decision; lower values useful only for shakeout tests). For 4 players, one
   round-robin cycle is 3 weekdays with 2 matches each (everyone plays
   everyone once). The canonical 4-player round-robin pairing:
   - Round 1: (A,B), (C,D)
   - Round 2: (A,C), (B,D)
   - Round 3: (A,D), (B,C)
   With K cycles, repeat this 3-round pattern K times. Skip weekends when
   assigning dates (use `America/New_York` to decide what counts as a
   weekday). For each match, draw 3 questions at random from unused
   questions and mark their `used_in_round` field. Player ordering within
   pairs is fixed by user id sort to keep generation deterministic.
4. Four user accounts created via PocketBase admin UI (manual, not scripted).

**Acceptance criteria:**
- `./pb/pocketbase serve` starts cleanly and the admin UI shows all collections.
- Running `scripts/import_questions.py` twice in a row results in the same row
  count both times (idempotency proven).
- Running `scripts/generate_season.py --season 1 --start-date 2026-06-01 --cycles 1`
  produces 6 match rows covering 3 weekdays, each with 3 distinct questions,
  no question used twice across the season, and every player appearing in
  exactly 3 matches.
- Running with `--cycles 4` (the season default) produces 24 match rows
  covering 12 weekdays, with every player facing every other player exactly
  4 times.
- All four users exist with `display_name` set.

**Out of scope for this phase:** any UI, any auth flow, any scoring.

---

### Phase 2 — Solo answering flow

**Scope:**
1. `web/index.html` + `app.js` + `style.css`. Load PocketBase JS SDK from a
   CDN (`https://unpkg.com/pocketbase@<pinned-version>/dist/pocketbase.umd.js` —
   pin the version explicitly).
2. Login screen: email + password, calls `pb.collection('users').authWithPassword`.
3. Dashboard (post-login):
   - Show today's match: opponent's `display_name`, match status.
   - If `status == pending` and the current user has not submitted answers:
     show a "Play today's match" button.
   - If the user has submitted but the opponent has not: show "Waiting on
     [opponent name]".
   - If `status == complete`: show "Match complete — see results" (results
     view is Phase 3; for now just a stub).
4. Play view: presents the three questions one at a time. For multiple-choice,
   show the correct answer and the incorrect answers shuffled. Submitting an
   answer creates a row in `answers`. After question 3, return to the
   dashboard with the "Waiting on opponent" state.
5. The match's `status` should advance from `pending` → `partial` when the
   first player completes their three answers, and `partial` → `complete`
   when the second does. This transition can live in a PocketBase hook on
   `answers` create — counting answers for the match and updating status
   accordingly. (The scoring logic in Phase 3 will key off the
   `partial → complete` transition.)

**Acceptance criteria:**
- Two players (test by opening two browser profiles, or your machine + your
  wife's) can each log in, see today's match, and submit answers
  independently. Neither sees the other's responses at any point.
- Match status correctly transitions through pending → partial → complete in
  the admin UI as answers are submitted.
- A player who already submitted cannot resubmit (the access rule on
  `answers.create` should block it).

**Out of scope for this phase:** results display, leaderboard, scoring math,
animations, anything visual beyond "functional and legible."

---

### Phase 3 — Scoring and results

**Scope:**
1. `pb/pb_hooks/scoring.pb.js` — fires on the `partial → complete` transition
   of a match (or, equivalently, when an `answers` create brings the count
   for a match to 6). Computes correct counts per player, determines winner
   (or tie), sets `matches.winner`, increments the relevant `standings` row
   for each player.
2. Results view in the web app: after a match is `complete`, both players
   can see a side-by-side breakdown of each question, both players'
   responses, the correct answer, and who got it right. Clear win/tie/loss
   indicator at the top.
3. Leaderboard view: ranked list of all four players for the current season
   with wins / ties / losses / points. Updated by reading `standings`.

**Acceptance criteria:**
- Complete a full match end-to-end and confirm: winner is set correctly,
  standings increment correctly, the loser's standings show a loss (not a
  win), ties produce 1 point each, both players see results only after the
  match completes.
- Forge a tie deliberately (same number correct) and confirm tie handling.
- Manually edit the `standings` table to confirm the leaderboard view
  reflects DB state, not cached state.

**Out of scope for this phase:** forfeits, season history, anything cosmetic.

---

### Phase 4 — Fun layer (deferred, do not start without explicit go-ahead)

Avatar display, trash-talk message attached to matches, win animations keyed
to result type. Fields already exist on `matches` and `users` — this phase is
purely UI/UX and content. **Do not start this phase as part of the initial
hand-off.** The user will explicitly green-light it.

---

### Phase 5 — Hardening

**Scope:**
1. Forfeit handling: a scheduled PocketBase hook that runs daily shortly
   after midnight ET (e.g. 00:05 ET) and marks any match whose `match_date`
   is in the past and whose status is not `complete` as `forfeit`. If exactly
   one player submitted all three answers, they win by forfeit (counted as a
   win in standings). If neither submitted (or only partial answers from one
   side), no points awarded. All time comparisons use `America/New_York`.
2. Season history: a view that lets you select a past season and see its
   final standings and match list.
3. Multi-cycle season UX: the schedule generator already supports `--cycles`,
   but the dashboard should handle "today has no match for me" gracefully
   (e.g. between cycles, or if a player got a bye — though with 4 players
   there are no byes, this is defensive).

**Acceptance criteria:**
- Manually backdate a `match_date`, run the forfeit hook, confirm correct
  status and standings outcome.
- Past seasons are viewable and don't get mixed with the current season's
  leaderboard.

---

## Working agreements (a.k.a. things I do not want)

- **Do not introduce a build step.** No webpack, vite, esbuild, parcel, no
  TypeScript compilation. If you find yourself wanting one, stop and ask.
- **Do not add UI frameworks.** Vanilla JS only.
- **Do not add a CSS framework.** Plain CSS or CSS variables are fine.
  Tailwind, Bootstrap, etc. are out.
- **Do not invent new collections or fields** without surfacing the change
  for review. The schema above is the contract.
- **Do not bypass server-side scoring.** Clients can display results but the
  hook is authoritative. No "let's just compute it client-side for now."
- **Do not modify `pull_trivia.py`.** It's working and tested.
- **Re-running any script must be safe.** Imports and generators are
  idempotent or explicitly versioned (e.g. by season number).
- **Commit messages are imperative-mood and reference the acceptance
  criterion they satisfy.** ("Phase 1 AC: import_questions.py idempotent on
  re-run".)
- **Ask before deleting or migrating data.** This is a tiny app but the data
  is irreplaceable mid-season.

---

## Resolved decisions (decision log)

Recorded so future-me and the agent know these were considered and settled:

1. **Hosting:** Hetzner CAX11 (ARM, €4/mo) is the default target, with
   CPX11 (x86, €5/mo) or DigitalOcean $6 droplet as drop-in alternatives.
   PocketBase manages its own TLS via Let's Encrypt — no separate reverse
   proxy unless we later have a reason. Setup in the Deployment appendix.
2. **Time zone:** `America/New_York`. All four players are East Coast and
   travel is rare enough that we'll handle it ad hoc if it ever happens.
3. **Daily cutoff:** Midnight Eastern. Match for date D closes at 23:59:59 ET
   on D.
4. **Season length:** 4 cycles (12 weekdays, 24 matches, each player vs
   each opponent 4 times).

---

## Deployment appendix

This appendix is for the *production* deployment. Phase 1 and 2 development
happens entirely on the local machine — only after Phase 2 is working
locally should you provision the VPS.

### Prerequisites you need before starting

- A domain name. If you don't already own one, grab one from Porkbun or
  Namecheap (~$10/year). A subdomain of a domain you already own works too
  (e.g. `trivia.example.com`).
- An SSH keypair you'll use to log into the VPS.

### One-time provisioning (do this once, by hand, not via the agent)

1. **Create the VPS.** On Hetzner Cloud: new project → new server → location
   close to East Coast (Ashburn, VA is `ash` — choose this for lowest
   latency to players) → image Ubuntu 24.04 → type CAX11 (ARM) or CPX11
   (x86) → SSH key uploaded → create. Note the public IP.
2. **Point DNS at it.** In your domain registrar, create an A record for
   `trivia.yourdomain.com` (or whatever subdomain) pointing to the VPS IP.
   Wait for propagation (`dig trivia.yourdomain.com` should return the IP).
3. **First login + harden.** SSH in as root, create a non-root user with
   sudo, disable root SSH login, enable UFW with only ports 22, 80, 443
   open. Standard new-server hygiene.

### PocketBase install (the agent CAN do this once SSH access is set up)

The minimal-setup approach (no nginx, no Caddy — PocketBase serves HTTPS
directly via Let's Encrypt). The current PocketBase version as of late
May 2026 is the 0.36 line; pin to whatever the latest stable tagged release
is at deploy time.

```bash
# As the non-root deploy user
sudo useradd -r -s /sbin/nologin pocketbase
sudo mkdir -p /opt/pocketbase
cd /tmp
# Replace VERSION and ARCH (linux_amd64 or linux_arm64) appropriately
wget https://github.com/pocketbase/pocketbase/releases/download/v<VERSION>/pocketbase_<VERSION>_<ARCH>.zip
unzip pocketbase_<VERSION>_<ARCH>.zip
sudo mv pocketbase /opt/pocketbase/
sudo chown -R pocketbase:pocketbase /opt/pocketbase
sudo chmod +x /opt/pocketbase/pocketbase
```

### systemd service

Create `/etc/systemd/system/pocketbase.service`:

```ini
[Unit]
Description=PocketBase
After=network.target

[Service]
Type=simple
User=pocketbase
Group=pocketbase
LimitNOFILE=4096
Restart=always
RestartSec=5s
WorkingDirectory=/opt/pocketbase
# --http empty + --https with a real port lets PocketBase do Let's Encrypt itself.
# Replace trivia.yourdomain.com with your real subdomain.
ExecStart=/opt/pocketbase/pocketbase serve trivia.yourdomain.com

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pocketbase
sudo systemctl status pocketbase
```

PocketBase will obtain a Let's Encrypt cert on first request to the domain.
Hit `https://trivia.yourdomain.com/_/` to reach the admin UI and create the
admin account.

### Deploying app code (hooks, frontend)

Two directories matter:

- `/opt/pocketbase/pb_hooks/` — `.pb.js` files here are loaded on PocketBase
  startup. Sync from the repo's `pb/pb_hooks/` directory.
- `/opt/pocketbase/pb_public/` — static files served at the root. Sync from
  the repo's `web/` directory.

A minimal deploy is just `rsync`:

```bash
rsync -av pb/pb_hooks/  user@host:/opt/pocketbase/pb_hooks/
rsync -av web/          user@host:/opt/pocketbase/pb_public/
ssh user@host 'sudo systemctl restart pocketbase'
```

Wrap this in a `scripts/deploy.sh` once the production target exists. Don't
build a CI pipeline for a four-person game; rsync from a laptop is correct
at this scale.

### Backups

PocketBase data is a single SQLite file at `/opt/pocketbase/pb_data/data.db`
plus an `auxiliary.db`. A nightly cron that `sqlite3 .backup`s both files to
a timestamped path, with retention of ~14 days, is enough. Even simpler:
`scp` the `pb_data/` directory to your laptop once a week. The data volume
is tiny.

### Migrations

PocketBase auto-generates migration files in `pb_migrations/` when you
change collections via the admin UI. Commit those. On the server, they run
automatically on startup. Workflow:

1. Make schema changes locally via admin UI.
2. Commit the generated migration files.
3. `rsync` `pb_migrations/` to the server.
4. Restart the service; migrations apply on startup.

---

## Reference: useful commands

```bash
# Start PocketBase locally
cd pb && ./pocketbase serve

# Pull questions (already documented in pull_trivia.py)
python3 pull_trivia.py

# Import into PocketBase (Phase 1)
python3 scripts/import_questions.py --db trivia.db --pb http://localhost:8090

# Generate the real 4-cycle season (Phase 1)
python3 scripts/generate_season.py --season 1 --start-date 2026-06-01 --cycles 4

# Quick eyeball of the question pool
sqlite3 trivia.db "SELECT category, difficulty, COUNT(*) FROM questions GROUP BY category, difficulty"
```
