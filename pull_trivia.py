#!/usr/bin/env python3
"""
pull_trivia.py — Fetch useless facts and build a True/False question pool.

Facts are split into two groups:
  Group A (even index): stored as-is with correct_answer = "True".
  Group B (odd index):  the original fact is discarded; Claude generates a
                        plausible-but-false variant stored with correct_answer = "False".

This ensures no fact and its false counterpart ever coexist in the pool.

Usage:
  python3 pull_trivia.py                   # fetch 160 facts (~80 True + ~80 False)
  python3 pull_trivia.py --count 20        # small test batch
  python3 pull_trivia.py --db pool.db      # custom output file
"""

import argparse
import hashlib
import json
import sqlite3
import sys
import time
import urllib.request

import anthropic

FACTS_URL = "https://uselessfacts.jsph.pl/api/v2/facts/random?language=en"
SLEEP_SECONDS = 1.1
MODEL = "claude-haiku-4-5-20251001"
DEFAULT_COUNT = 160


def source_id_true(fact_text):
    return hashlib.sha1(fact_text.encode()).hexdigest()


def source_id_false(stored_text):
    # Keyed on the stored text (the false variant), not the source fact, so two
    # source facts that generate the same Claude output don't create duplicate rows.
    return hashlib.sha1(("FALSE:" + stored_text).encode()).hexdigest()


def init_db(path):
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS questions (
            source_id      TEXT PRIMARY KEY,
            category       TEXT NOT NULL,
            text           TEXT NOT NULL,
            correct_answer TEXT NOT NULL,
            used_in_round  INTEGER,
            source_url     TEXT
        )
    """)
    # Add source_url to existing databases that pre-date this column.
    try:
        conn.execute("ALTER TABLE questions ADD COLUMN source_url TEXT")
    except sqlite3.OperationalError:
        pass  # column already exists
    conn.commit()
    return conn


def fetch_fact():
    req = urllib.request.Request(FACTS_URL, headers={"User-Agent": "trivia-league/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read().decode())
    return data["text"], data.get("source_url")


def generate_false_variant(client, fact_text):
    prompt = (
        f'Here is a true fact: "{fact_text}"\n'
        "Write one plausible-but-false statement on the same general topic "
        "(not a direct negation of this exact fact).\n"
        "Keep it similar in style and length. Output ONLY the false statement, nothing else."
    )
    msg = client.messages.create(
        model=MODEL,
        max_tokens=256,
        messages=[{"role": "user", "content": prompt}],
    )
    text = msg.content[0].text.strip()
    if not text:
        raise ValueError("Claude returned an empty false variant")
    return text


def upsert_question(conn, source_id, text, correct_answer, source_url=None):
    cur = conn.execute(
        "INSERT OR IGNORE INTO questions (source_id, category, text, correct_answer, source_url) VALUES (?, ?, ?, ?, ?)",
        (source_id, "Useless Facts", text, correct_answer, source_url),
    )
    conn.commit()
    return cur.rowcount


def main():
    ap = argparse.ArgumentParser(description="Fetch useless facts into a T/F question pool.")
    ap.add_argument("--count", type=int, default=DEFAULT_COUNT,
                    help=f"facts to fetch (default {DEFAULT_COUNT}; half become True, half False)")
    ap.add_argument("--db", default="trivia.db", help="output SQLite file (default: trivia.db)")
    args = ap.parse_args()

    client = anthropic.Anthropic()
    conn = init_db(args.db)

    added_true = 0
    added_false = 0
    skipped = 0
    errors = 0

    print(f"Fetching {args.count} facts → ~{args.count // 2} True + ~{args.count // 2} False")
    print(f"Writing to {args.db}\n")

    for i in range(args.count):
        try:
            fact, fact_source_url = fetch_fact()
        except Exception as e:
            print(f"  [{i}] fetch error: {e}", file=sys.stderr)
            errors += 1
            time.sleep(SLEEP_SECONDS)
            continue

        if i % 2 == 0:
            # Group A: store the fact as-is (True)
            sid = source_id_true(fact)
            added = upsert_question(conn, sid, fact, "True", fact_source_url)
            if added:
                added_true += 1
                print(f"  [{i}] TRUE : {fact[:80]}")
            else:
                skipped += 1
        else:
            # Group B: discard the original; store only Claude's false variant
            try:
                false_variant = generate_false_variant(client, fact)
            except Exception as e:
                print(f"  [{i}] Claude error: {e}", file=sys.stderr)
                errors += 1
                time.sleep(SLEEP_SECONDS)
                continue
            sid = source_id_false(false_variant)
            added = upsert_question(conn, sid, false_variant, "False")
            if added:
                added_false += 1
                print(f"  [{i}] FALSE: {false_variant[:80]}")
            else:
                skipped += 1

        time.sleep(SLEEP_SECONDS)

    total = conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    conn.close()
    print(f"\nDone. +{added_true} True, +{added_false} False added. "
          f"{skipped} dupes skipped, {errors} errors. "
          f"{total} questions total in {args.db}.")


if __name__ == "__main__":
    main()
