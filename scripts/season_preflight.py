#!/usr/bin/env python3
"""
season_preflight.py — Inspect a PocketBase instance before generating a season.

Authenticates as a superuser, then reports:
  - the next season number (max existing season + 1, or 1 if none)
  - the player count (generate_season.py requires exactly 4)
  - the unused-question pool vs. what the requested cycles need

If everything checks out it prints the exact generate_season.py command to run.
Read-only: it never writes to the database.

Usage:
  PB_ADMIN_PASSWORD=... python3 scripts/season_preflight.py \
      --pb https://trivia.jwcaterine.com --admin you@example.com \
      --start-date 2026-06-29 --cycles 4
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
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


def api_get(pb_url, token, path):
    req = urllib.request.Request(f"{pb_url}{path}", headers={"Authorization": token})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def get_all_records(pb_url, token, collection, filter_str="", fields=""):
    items = []
    page = 1
    per_page = 500
    while True:
        params = f"page={page}&perPage={per_page}"
        if filter_str:
            params += f"&filter={urllib.parse.quote(filter_str)}"
        if fields:
            params += f"&fields={fields}"
        data = api_get(pb_url, token, f"/api/collections/{collection}/records?{params}")
        items.extend(data["items"])
        if page >= data["totalPages"]:
            break
        page += 1
    return items


def main():
    ap = argparse.ArgumentParser(description="Preflight check before generating a season.")
    ap.add_argument("--start-date", required=True, help="first match date YYYY-MM-DD (ET)")
    ap.add_argument("--cycles", type=int, default=4, help="number of round-robin cycles (default 4)")
    ap.add_argument("--pb", default="http://localhost:8090", help="PocketBase base URL")
    ap.add_argument("--admin", default="admin@trivia.local", help="admin (superuser) email")
    ap.add_argument("--password", default=os.environ.get("PB_ADMIN_PASSWORD"),
                    help="admin password (or set PB_ADMIN_PASSWORD env var)")
    args = ap.parse_args()

    if not args.password:
        print("Error: admin password required. Use --password or set PB_ADMIN_PASSWORD.", file=sys.stderr)
        sys.exit(1)

    token = authenticate(args.pb, args.admin, args.password)

    matches = get_all_records(args.pb, token, "matches", fields="season,match_date,status")
    seasons = sorted({m["season"] for m in matches})
    max_season = max(seasons) if seasons else 0
    next_season = max_season + 1

    users = get_all_records(args.pb, token, "users", fields="id")
    unused = get_all_records(args.pb, token, "questions", filter_str="used_in_round = 0", fields="id")
    needed = 5 * 2 * 3 * args.cycles  # 5 q × 2 matches/day × 3 weekdays × cycles

    print(f"PocketBase:        {args.pb}")
    print(f"Existing seasons:  {seasons or '(none)'}  ->  next season = {next_season}")
    print(f"Players:           {len(users)}  (generate_season.py requires exactly 4)")
    print(f"Unused questions:  {len(unused)}  /  {needed} needed for {args.cycles} cycle(s)")
    print()

    # Per-season breakdown: is each season finished/pending, and what dates?
    print("Per-season match state:")
    for s in seasons:
        rows = [m for m in matches if m["season"] == s]
        dates = sorted(m.get("match_date", "")[:10] for m in rows if m.get("match_date"))
        status_counts = {}
        for m in rows:
            status_counts[m.get("status", "?")] = status_counts.get(m.get("status", "?"), 0) + 1
        status_str = ", ".join(f"{k}={v}" for k, v in sorted(status_counts.items()))
        date_range = f"{dates[0]} -> {dates[-1]}" if dates else "(no dates)"
        print(f"  season {s}: {len(rows)} matches | {date_range} | {status_str}")
    print()

    ok = True
    if len(users) != 4:
        print(f"BLOCKER: expected 4 players, found {len(users)}.")
        ok = False
    if len(unused) < needed:
        print(f"BLOCKER: short {needed - len(unused)} questions. "
              f"Import more (scripts/import_questions.py) or reduce --cycles.")
        ok = False

    if ok:
        print("Ready. Run:")
        print()
        print(f"  PB_ADMIN_PASSWORD=$PB_ADMIN_PASSWORD python3 scripts/generate_season.py \\")
        print(f"      --pb {args.pb} --admin {args.admin} \\")
        print(f"      --season {next_season} --start-date {args.start_date} --cycles {args.cycles}")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
