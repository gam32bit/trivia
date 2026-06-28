#!/usr/bin/env python3
"""
create_test_match.py — Create a single throwaway preseason test match.

A test match (season -1, round -1) dated today between two named players, using
questions that won't spoil either player's real-season matches. Season/round
use -1 because PocketBase rejects 0 as "blank" on these required fields, and a
negative season stays below the real seasons so the leaderboard's
"current season = max" never defaults to the test.

Question sources (--source):
  reuse  (default): take the 5 questions from an existing season-1 match that
                    excludes BOTH test players. In a 4-player round-robin that
                    is exactly the complementary pairing, so neither test player
                    ever meets these questions in a real match. Requires the
                    target season (default 1) to already be generated.
  fresh           : draw 5 unused questions (used_in_round = 0) and mark them
                    used_in_round = -1 (a non-zero "burned for test" sentinel,
                    so generate_season's `used_in_round = 0` filter skips them).
                    Works before the real season exists.

Isolation: the match is season -1, so when it completes the scoring hook upserts
season-(-1) standings — kept entirely out of the real season's leaderboard
(which defaults to the highest season number).

Idempotent: exits without changes if a season -1 match already exists.

Auth: admin password from --password or the PB_ADMIN_PASSWORD env var.

Usage:
  PB_ADMIN_PASSWORD=... python3 scripts/create_test_match.py \
      --pb https://trivia.jwcaterine.com --admin you@example.com \
      --player-a Joemomma --player-b Kelly
"""

import argparse
import json
import os
import random
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date


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
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        print(f"POST {path} failed: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)


def api_patch(pb_url, token, path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{pb_url}{path}", data=data,
        headers={"Authorization": token, "Content-Type": "application/json"},
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        print(f"PATCH {path} failed: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)


def get_all_records(pb_url, token, collection, filter_str="", fields=""):
    items = []
    page = 1
    while True:
        params = f"page={page}&perPage=500"
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
    ap = argparse.ArgumentParser(description="Create a throwaway preseason test match.")
    ap.add_argument("--player-a", required=True, help="display_name of the first test player")
    ap.add_argument("--player-b", required=True, help="display_name of the second test player")
    ap.add_argument("--source", choices=["reuse", "fresh"], default="reuse",
                    help="question source: reuse a season match excluding both players, or draw fresh")
    ap.add_argument("--from-season", type=int, default=1,
                    help="season to borrow questions from when --source reuse (default 1)")
    ap.add_argument("--date", default=date.today().isoformat(),
                    help="match date YYYY-MM-DD (default: today, local)")
    ap.add_argument("--pb", default="http://localhost:8090", help="PocketBase base URL")
    ap.add_argument("--admin", default="admin@trivia.local", help="admin email")
    ap.add_argument("--password", default=os.environ.get("PB_ADMIN_PASSWORD"),
                    help="admin password (or set PB_ADMIN_PASSWORD env var)")
    args = ap.parse_args()

    if not args.password:
        print("Error: admin password required. Use --password or set PB_ADMIN_PASSWORD.", file=sys.stderr)
        sys.exit(1)

    token = authenticate(args.pb, args.admin, args.password)

    # Idempotency guard: never create a second test (season -1) match.
    existing = get_all_records(args.pb, token, "matches", filter_str="season = -1", fields="id")
    if existing:
        print(f"A test (season -1) match already exists ({existing[0]['id']}). Nothing to do.")
        sys.exit(0)

    # Resolve the two test players by display_name.
    users = get_all_records(args.pb, token, "users", fields="id,display_name")
    print("Users found:")
    for u in users:
        print(f"  {u['id']}  {u['display_name']}")
    by_name = {u["display_name"]: u["id"] for u in users}
    for name in (args.player_a, args.player_b):
        if name not in by_name:
            print(f"\nNo user with display_name {name!r}. Available: "
                  f"{[u['display_name'] for u in users]}", file=sys.stderr)
            sys.exit(1)
    a_id, b_id = by_name[args.player_a], by_name[args.player_b]

    # Choose the 3 questions.
    if args.source == "reuse":
        # A season match that excludes BOTH test players -> its questions never
        # appear in any match either test player plays. (Complementary pairing.)
        flt = (f"season = {args.from_season} && "
               f'player_a != "{a_id}" && player_a != "{b_id}" && '
               f'player_b != "{a_id}" && player_b != "{b_id}"')
        src = get_all_records(args.pb, token, "matches", filter_str=flt,
                              fields="id,round,player_a,player_b,questions")
        if not src:
            print(f"No season-{args.from_season} match excludes both players yet. "
                  f"Generate that season first, or use --source fresh.", file=sys.stderr)
            sys.exit(1)
        m = src[0]
        questions = m["questions"]
        print(f"\nBorrowing 5 questions from season-{args.from_season} match {m['id']} "
              f"(round {m['round']}) — neither test player is in it.")
    else:  # fresh
        unused = get_all_records(args.pb, token, "questions",
                                 filter_str="used_in_round = 0", fields="id")
        if len(unused) < 5:
            print(f"Need 5 unused questions, found {len(unused)}.", file=sys.stderr)
            sys.exit(1)
        random.shuffle(unused)
        questions = [q["id"] for q in unused[:5]]
        for qid in questions:
            # -1 = burned for a test: non-zero so generate_season won't reuse it.
            api_patch(args.pb, token, f"/api/collections/questions/records/{qid}",
                      {"used_in_round": -1})
        print("\nDrew 5 fresh questions and marked them used_in_round=-1 (won't be reused).")

    match_body = {
        "season": -1,
        "round": -1,
        "match_date": args.date + " 00:00:00.000Z",
        "player_a": a_id,
        "player_b": b_id,
        "questions": questions,
        "status": "pending",
    }
    created = api_post(args.pb, token, "/api/collections/matches/records", match_body)
    print(f"\nCreated test match {created['id']}: {args.player_a} vs {args.player_b} "
          f"on {args.date} (season -1). Both players will see it as today's match.")


if __name__ == "__main__":
    main()
