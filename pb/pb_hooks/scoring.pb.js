// Phase 3: advance match status on answer submission, AND score the match
// (winner + standings) on the partial -> complete transition.
//
// Fires after every answers create. We count answers per player for the match:
//   - first player reaches 5  -> pending -> partial
//   - second player reaches 5 -> partial -> complete, then score.
//
// Scoring (locked decision): win = 2 pts, tie = 1 pt each, loss = 0 pts.
// Standings rows are upserted here because generate_season.py does not
// pre-create them; (season, player) is the natural key.
//
// NOTE: PocketBase's JSVM runs each hook handler in an isolated scope that does
// NOT share the file's top-level definitions, so every helper lives inside the
// handler below.
onRecordAfterCreateSuccess((e) => {
  const matchId = e.record.getString("match");

  const allAnswers = $app.findAllRecords("answers", $dbx.hashExp({ "match": matchId }));

  const playerCounts = {};
  for (const a of allAnswers) {
    const pid = a.getString("player");
    playerCounts[pid] = (playerCounts[pid] || 0) + 1;
  }

  const donePlayers = Object.values(playerCounts).filter((c) => c >= 5).length;
  if (donePlayers === 0) return;

  const match = $app.findRecordById("matches", matchId);
  const currentStatus = match.getString("status");

  // First player finished: pending -> partial.
  if (donePlayers === 1 && currentStatus === "pending") {
    match.set("status", "partial");
    $app.save(match);
    return;
  }

  // Anything other than the second player finishing an in-progress match is a
  // no-op (also guards against re-scoring an already-complete match).
  if (donePlayers < 2 || currentStatus !== "partial") return;

  // ---- partial -> complete: score the match ----
  const playerA = match.getString("player_a");
  const playerB = match.getString("player_b");

  let correctA = 0;
  let correctB = 0;
  for (const a of allAnswers) {
    if (!a.getBool("is_correct")) continue;
    const pid = a.getString("player");
    if (pid === playerA) correctA++;
    else if (pid === playerB) correctB++;
  }

  let winnerId = "";
  let resultA = "tie";
  let resultB = "tie";
  if (correctA > correctB) {
    winnerId = playerA;
    resultA = "win";
    resultB = "loss";
  } else if (correctB > correctA) {
    winnerId = playerB;
    resultA = "loss";
    resultB = "win";
  }

  match.set("status", "complete");
  match.set("winner", winnerId); // "" leaves the relation empty on a tie
  $app.save(match);

  const season = match.getInt("season");

  const applyResult = (playerId, result) => {
    let row = null;
    try {
      row = $app.findFirstRecordByFilter(
        "standings",
        "season = {:season} && player = {:player}",
        { season: season, player: playerId }
      );
    } catch (_) {
      row = null; // no standings row yet for this (season, player)
    }
    if (!row) {
      row = new Record($app.findCollectionByNameOrId("standings"));
      row.set("season", season);
      row.set("player", playerId);
      row.set("wins", 0);
      row.set("ties", 0);
      row.set("losses", 0);
      row.set("points", 0);
    }
    if (result === "win") {
      row.set("wins", row.getInt("wins") + 1);
      row.set("points", row.getInt("points") + 2);
    } else if (result === "tie") {
      row.set("ties", row.getInt("ties") + 1);
      row.set("points", row.getInt("points") + 1);
    } else {
      row.set("losses", row.getInt("losses") + 1);
    }
    $app.save(row);
  };

  applyResult(playerA, resultA);
  applyResult(playerB, resultB);
}, "answers");
