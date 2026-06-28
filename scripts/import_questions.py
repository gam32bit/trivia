#!/usr/bin/env python3
"""
import_questions.py — Import questions from trivia.db into PocketBase.

Idempotent: uses source_id as the dedupe key. Re-running adds only new questions
and never creates duplicates.

Usage:
  python3 scripts/import_questions.py --db trivia.db --pb http://localhost:8090
  python3 scripts/import_questions.py --db trivia.db --pb http://localhost:8090 --admin admin@trivia.local --password secret
"""

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request


def authenticate(pb_url, admin_email, admin_password):
    url = f"{pb_url}/api/collections/_superusers/auth-with-password"
    body = json.dumps({"identity": admin_email, "password": admin_password}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)["token"]
    except urllib.error.HTTPError as e:
        print(f"Auth failed: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)


def fetch_existing_ids(pb_url, token):
    """Return set of all source_ids already in PocketBase."""
    existing = set()
    page = 1
    per_page = 500
    headers = {"Authorization": token}
    while True:
        url = f"{pb_url}/api/collections/questions/records?page={page}&perPage={per_page}&fields=source_id"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
        for item in data["items"]:
            existing.add(item["source_id"])
        if page >= data["totalPages"]:
            break
        page += 1
    return existing


def create_question(pb_url, token, row, existing_ids):
    """Insert one question if not already present. Returns True if inserted."""
    source_id, category, text, correct_answer, used_in_round = row
    if source_id in existing_ids:
        return False
    body = {
        "source_id": source_id,
        "category": category,
        "text": text,
        "correct_answer": correct_answer,
    }
    if used_in_round is not None:
        body["used_in_round"] = used_in_round

    url = f"{pb_url}/api/collections/questions/records"
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Authorization": token, "Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as r:
            r.read()
        return True
    except urllib.error.HTTPError as e:
        msg = e.read().decode()
        if "unique" in msg.lower() or e.code == 400:
            return False
        print(f"Error inserting {source_id}: {e.code} {msg}", file=sys.stderr)
        return False


def main():
    ap = argparse.ArgumentParser(description="Import questions from trivia.db into PocketBase.")
    ap.add_argument("--db", default="trivia.db", help="path to trivia.db")
    ap.add_argument("--pb", default="http://localhost:8090", help="PocketBase base URL")
    ap.add_argument("--admin", default="admin@trivia.local", help="admin email")
    ap.add_argument("--password", default=os.environ.get("PB_ADMIN_PASSWORD"),
                    help="admin password (or set PB_ADMIN_PASSWORD env var)")
    args = ap.parse_args()

    if not args.password:
        print("Error: admin password required. Use --password or set PB_ADMIN_PASSWORD.", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(args.db)
    rows = conn.execute(
        "SELECT source_id, category, text, correct_answer, used_in_round FROM questions"
    ).fetchall()
    conn.close()
    print(f"trivia.db: {len(rows)} questions total")

    token = authenticate(args.pb, args.admin, args.password)
    existing = fetch_existing_ids(args.pb, token)
    print(f"PocketBase: {len(existing)} questions already imported")

    added = 0
    skipped = 0
    for row in rows:
        if create_question(args.pb, token, row, existing):
            added += 1
        else:
            skipped += 1
        if (added + skipped) % 100 == 0:
            print(f"  processed {added + skipped}/{len(rows)} (+{added} new, {skipped} skipped)")

    print(f"Done. +{added} new questions imported, {skipped} already existed.")


if __name__ == "__main__":
    main()
