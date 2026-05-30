#!/usr/bin/env python3
"""
pull_trivia.py — Bulk-pull the Open Trivia DB question pool into a local SQLite file.

Why this exists:
  We don't want a live OpenTDB dependency in the daily match flow. Instead we pull
  the whole pool once into our own store, dedupe on OpenTDB's stable question hash,
  and let the game draw exclusively from local data. Re-running this is safe — it
  upserts, so new questions get added and existing ones are left alone.

OpenTDB facts this script respects:
  - No API key needed.
  - Rate limit: 1 request per IP per 5 seconds (we sleep 5.5s to be safe).
  - Max 50 questions per call.
  - A session token prevents repeats until the pool is exhausted (response_code 4).
  - We walk each category at each difficulty to drain the pool methodically.

Output:
  A SQLite file (default: trivia.db) with one `questions` table. This is intentionally
  a plain, portable file you can inspect with `sqlite3 trivia.db` or import into
  PocketBase however you like. The schema mirrors the fields you'll want in PocketBase.

Usage:
  python3 pull_trivia.py                 # pull everything, easy+medium+hard
  python3 pull_trivia.py --db pool.db    # custom output file
  python3 pull_trivia.py --difficulty medium   # restrict difficulty
  python3 pull_trivia.py --category 9    # restrict to one category id
  python3 pull_trivia.py --dry-run       # show the plan, fetch nothing
"""

import argparse
import hashlib
import html
import json
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = "https://opentdb.com"
SLEEP_SECONDS = 5.5          # one request / 5s limit, with headroom
MAX_PER_CALL = 50            # OpenTDB hard cap
DIFFICULTIES = ["easy", "medium", "hard"]


def http_get_json(url, retries=4):
    """GET a URL and parse JSON, retrying on rate-limit / transient errors."""
    backoff = SLEEP_SECONDS
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "trivia-league/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 — we want to retry on anything network-ish
            if attempt == retries - 1:
                raise
            print(f"    ! request failed ({e}); backing off {backoff:.0f}s", file=sys.stderr)
            time.sleep(backoff)
            backoff *= 2
    return None


def get_token():
    data = http_get_json(f"{BASE}/api_token.php?command=request")
    if not data or data.get("response_code") != 0:
        raise RuntimeError(f"could not obtain session token: {data}")
    return data["token"]


def get_categories():
    data = http_get_json(f"{BASE}/api_category.php")
    return data["trivia_categories"]  # list of {id, name}


def get_category_counts(cat_id):
    """Return total verified questions available for a category."""
    data = http_get_json(f"{BASE}/api_count.php?category={cat_id}")
    qc = data.get("category_question_count", {})
    return qc.get("total_question_count", 0)


def stable_id(category, qtype, difficulty, question, correct):
    """Replicate OpenTDB's dedupe key: SHA-1 of the defining fields.

    This is the same idea third-party scrapers use, giving us a stable id so
    re-runs and cross-source merges don't create duplicates.
    """
    raw = "|".join([category, qtype, difficulty, question, correct])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def init_db(path):
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS questions (
            otdb_id           TEXT PRIMARY KEY,
            category          TEXT NOT NULL,
            difficulty        TEXT NOT NULL,
            type              TEXT NOT NULL,
            question          TEXT NOT NULL,
            correct_answer    TEXT NOT NULL,
            incorrect_answers TEXT NOT NULL,   -- JSON array
            pulled_at         TEXT NOT NULL,
            used_in_round     INTEGER          -- NULL until used in a match
        )
        """
    )
    conn.commit()
    return conn


def upsert_questions(conn, results):
    """Insert questions, ignoring ones we already have. Returns count newly added."""
    added = 0
    now = datetime.now(timezone.utc).isoformat()
    for r in results:
        # OpenTDB encodes entities (default encoding); unescape to clean text.
        category = html.unescape(r["category"])
        qtype = r["type"]
        difficulty = r["difficulty"]
        question = html.unescape(r["question"])
        correct = html.unescape(r["correct_answer"])
        incorrect = [html.unescape(x) for x in r["incorrect_answers"]]
        oid = stable_id(category, qtype, difficulty, question, correct)
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO questions
              (otdb_id, category, difficulty, type, question,
               correct_answer, incorrect_answers, pulled_at, used_in_round)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (oid, category, difficulty, qtype, question,
             correct, json.dumps(incorrect), now),
        )
        added += cur.rowcount
    conn.commit()
    return added


def drain_category(conn, token, cat_id, cat_name, difficulty):
    """Pull all available questions for one (category, difficulty) pair."""
    total_added = 0
    while True:
        params = {
            "amount": MAX_PER_CALL,
            "category": cat_id,
            "difficulty": difficulty,
            "encode": "url3986",
            "token": token,
        }
        url = f"{BASE}/api.php?" + urllib.parse.urlencode(params)
        time.sleep(SLEEP_SECONDS)
        data = http_get_json(url)
        code = data.get("response_code")

        if code == 0:
            # Decode url3986-encoded fields back to plain strings.
            results = []
            for item in data["results"]:
                results.append({
                    "category": urllib.parse.unquote(item["category"]),
                    "type": urllib.parse.unquote(item["type"]),
                    "difficulty": urllib.parse.unquote(item["difficulty"]),
                    "question": urllib.parse.unquote(item["question"]),
                    "correct_answer": urllib.parse.unquote(item["correct_answer"]),
                    "incorrect_answers": [urllib.parse.unquote(x) for x in item["incorrect_answers"]],
                })
            added = upsert_questions(conn, results)
            total_added += added
            print(f"    {cat_name} [{difficulty}]: +{added} new "
                  f"({len(results)} returned)")
            # Fewer than a full page means the pool for this slice is nearly drained,
            # but the token still guards against repeats, so keep going until code 4.
        elif code == 4:
            # Token has returned everything it can for this query — done with this slice.
            print(f"    {cat_name} [{difficulty}]: pool exhausted")
            break
        elif code == 1:
            # No results for this category/difficulty combination.
            print(f"    {cat_name} [{difficulty}]: no questions")
            break
        elif code == 5:
            print(f"    {cat_name} [{difficulty}]: rate limited, waiting", file=sys.stderr)
            time.sleep(SLEEP_SECONDS * 2)
            continue
        else:
            print(f"    {cat_name} [{difficulty}]: unexpected code {code}, skipping",
                  file=sys.stderr)
            break
    return total_added


def main():
    ap = argparse.ArgumentParser(description="Bulk-pull OpenTDB into local SQLite.")
    ap.add_argument("--db", default="trivia.db", help="output SQLite file")
    ap.add_argument("--difficulty", choices=DIFFICULTIES,
                    help="restrict to one difficulty (default: all)")
    ap.add_argument("--category", type=int,
                    help="restrict to one OpenTDB category id (default: all)")
    ap.add_argument("--dry-run", action="store_true",
                    help="show the plan and counts, fetch no questions")
    args = ap.parse_args()

    print("Fetching category list...")
    categories = get_categories()
    if args.category:
        categories = [c for c in categories if c["id"] == args.category]
        if not categories:
            print(f"No category with id {args.category}", file=sys.stderr)
            sys.exit(1)

    difficulties = [args.difficulty] if args.difficulty else DIFFICULTIES

    if args.dry_run:
        print(f"\nPlan: {len(categories)} categories x {len(difficulties)} difficulties")
        grand = 0
        for c in categories:
            time.sleep(SLEEP_SECONDS)
            n = get_category_counts(c["id"])
            grand += n
            print(f"  {c['name']}: {n} total verified questions")
        print(f"\nApprox {grand} questions in the targeted pool "
              f"(spread across difficulties).")
        print("Run without --dry-run to pull. Expect roughly "
              f"{len(categories) * len(difficulties) * SLEEP_SECONDS / 60:.0f}+ min "
              "due to the 5s rate limit.")
        return

    conn = init_db(args.db)
    token = get_token()
    print(f"Session token acquired. Writing to {args.db}\n")

    grand_total = 0
    for c in categories:
        print(f"  Category: {c['name']} (id {c['id']})")
        for d in difficulties:
            grand_total += drain_category(conn, token, c["id"], c["name"], d)

    count = conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    conn.close()
    print(f"\nDone. {grand_total} new this run. {count} questions total in {args.db}.")


if __name__ == "__main__":
    main()
