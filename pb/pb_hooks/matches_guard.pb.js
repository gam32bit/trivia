// Phase 4 hardening: restrict client-side updates to the matches collection.
//
// The matches updateRule lets a player (player_a or player_b) PATCH their own
// match — needed so a winner can post a victory taunt (a_taunt / b_taunt). But
// a record-level access rule can't limit WHICH fields are written, so without
// this guard a player could also overwrite winner / status / questions and
// bypass the authoritative server-side scoring. This hook rejects any
// non-superuser update that changes a field other than a_taunt / b_taunt.
//
// Internal saves from scoring.pb.js / forfeits.pb.js call $app.save() directly
// and never pass through *Request hooks, so scoring is unaffected.
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const before = e.record.original();
    const guarded = [
      "season", "round", "match_date", "player_a", "player_b",
      "questions", "status", "winner", "winner_animation",
    ];
    for (const f of guarded) {
      if (JSON.stringify(before.get(f)) !== JSON.stringify(e.record.get(f))) {
        throw new ForbiddenError("Players may only update match taunts.");
      }
    }
  }
  e.next();
}, "matches");
