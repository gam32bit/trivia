#!/usr/bin/env python3
"""
generate_season.py — Create matches for a season in PocketBase.

Round-robin pairing for 4 players (sorted by user id, A < B < C < D):
  Round 1: (A,B), (C,D)
  Round 2: (A,C), (B,D)
  Round 3: (A,D), (B,C)
Repeated for --cycles cycles. Dates are consecutive weekdays (Mon-Fri) in
America/New_York, starting from --start-date.

Questions are drawn at random from unused questions (used_in_round IS NULL)
and marked with the round number. 5 questions per match, never reused.

Idempotent by season: exits without changes if season N already has matches.

Usage:
  python3 scripts/generate_season.py --season 1 --start-date 2026-06-01
  python3 scripts/generate_season.py --season 1 --start-date 2026-06-01 --cycles 1
"""

import argparse
import json
import os
import random
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta


# Canonical 4-player round-robin pairings (indices into sorted-by-id user list)
ROUND_ROBIN_PAIRS = [
    [(0, 1), (2, 3)],  # Round 1
    [(0, 2), (1, 3)],  # Round 2
    [(0, 3), (1, 2)],  # Round 3
]


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


def api_post(pb_url, token, path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{pb_url}{path}", data=data,
        headers={"Authorization": token, "Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def api_patch(pb_url, token, path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{pb_url}{path}", data=data,
        headers={"Authorization": token, "Content-Type": "application/json"},
        method="PATCH"
    )
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


def build_weekday_dates(start, count):
    """Return list of `count` weekday (Mon-Fri) dates starting from start."""
    days = []
    d = start
    while d.weekday() >= 5:  # skip if start itself is a weekend
        d += timedelta(days=1)
    while len(days) < count:
        days.append(d)
        d += timedelta(days=1)
        while d.weekday() >= 5:
            d += timedelta(days=1)
    return days


def main():
    ap = argparse.ArgumentParser(description="Generate a trivia season's matches.")
    ap.add_argument("--season", type=int, required=True, help="season number (e.g. 1)")
    ap.add_argument("--start-date", required=True, help="first match date YYYY-MM-DD (ET)")
    ap.add_argument("--cycles", type=int, default=4, help="number of round-robin cycles (default 4)")
    ap.add_argument("--pb", default="http://localhost:8090", help="PocketBase base URL")
    ap.add_argument("--admin", default="admin@trivia.local", help="admin email")
    ap.add_argument("--password", default=os.environ.get("PB_ADMIN_PASSWORD"),
                    help="admin password (or set PB_ADMIN_PASSWORD env var)")
    args = ap.parse_args()

    if not args.password:
        print("Error: admin password required. Use --password or set PB_ADMIN_PASSWORD.", file=sys.stderr)
        sys.exit(1)

    start_date = date.fromisoformat(args.start_date)
    token = authenticate(args.pb, args.admin, args.password)

    # Idempotency guard
    existing = get_all_records(pb_url=args.pb, token=token, collection="matches",
                                filter_str=f"season={args.season}", fields="id")
    if existing:
        print(f"Season {args.season} already has {len(existing)} matches. Nothing to do.")
        sys.exit(0)

    # Fetch all users, sort by id for deterministic A/B/C/D assignment
    users = get_all_records(args.pb, token, "users", fields="id,display_name")
    users.sort(key=lambda u: u["id"])
    if len(users) != 4:
        print(f"Expected exactly 4 users, found {len(users)}. Create all 4 accounts first.", file=sys.stderr)
        sys.exit(1)
    print(f"Players (A→D): {[u['display_name'] for u in users]}")

    # Build weekday date list: 3 days per cycle × cycles
    total_days = 3 * args.cycles
    match_dates = build_weekday_dates(start_date, total_days)

    # Fetch all unused questions
    # PocketBase stores 0 (not null) for unset number fields; rounds are 1-indexed, so 0 = unused.
    unused_q = get_all_records(args.pb, token, "questions",
                                filter_str="used_in_round = 0", fields="id")
    questions_needed = 5 * 2 * total_days  # 5 questions × 2 matches/day × days
    if len(unused_q) < questions_needed:
        print(f"Need {questions_needed} unused questions but only {len(unused_q)} available.", file=sys.stderr)
        sys.exit(1)

    random.shuffle(unused_q)
    q_pool = [q["id"] for q in unused_q]
    q_idx = 0

    print(f"\nGenerating season {args.season}: {args.cycles} cycles × 3 weekdays "
          f"= {total_days} days, {total_days * 2} matches")

    matches_created = 0
    round_num = 1  # 1-indexed day number within the season

    for cycle in range(args.cycles):
        for day_in_cycle, pairs in enumerate(ROUND_ROBIN_PAIRS):
            match_date = match_dates[cycle * 3 + day_in_cycle]
            for (i, j) in pairs:
                player_a = users[i]["id"]
                player_b = users[j]["id"]
                qs = q_pool[q_idx:q_idx + 5]
                q_idx += 5

                match_body = {
                    "season": args.season,
                    "round": round_num,
                    "match_date": match_date.isoformat() + " 00:00:00.000Z",
                    "player_a": player_a,
                    "player_b": player_b,
                    "questions": qs,
                    "status": "pending",
                }
                api_post(args.pb, token, "/api/collections/matches/records", match_body)
                matches_created += 1

                # Mark questions as used in this round
                for qid in qs:
                    api_patch(args.pb, token, f"/api/collections/questions/records/{qid}",
                              {"used_in_round": round_num})

                pa_name = users[i]["display_name"]
                pb_name = users[j]["display_name"]
                print(f"  {match_date} round {round_num}: {pa_name} vs {pb_name}")

            round_num += 1

    print(f"\nCreated {matches_created} matches.")


if __name__ == "__main__":
    main()
