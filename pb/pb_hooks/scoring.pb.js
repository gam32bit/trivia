// Phase 2: Advance match status when answers are submitted.
// Phase 3 will add scoring logic (winner, standings) to the complete transition.
onRecordAfterCreateSuccess((e) => {
  const matchId = e.record.getString("match");

  const allAnswers = $app.findAllRecords("answers", $dbx.hashExp({"match": matchId}));

  const playerCounts = {};
  for (const a of allAnswers) {
    const pid = a.getString("player");
    playerCounts[pid] = (playerCounts[pid] || 0) + 1;
  }

  const donePlayers = Object.values(playerCounts).filter(c => c >= 3).length;
  if (donePlayers === 0) return;

  const match = $app.findRecordById("matches", matchId);
  const currentStatus = match.getString("status");

  let newStatus = null;
  if (donePlayers === 1 && currentStatus === "pending") {
    newStatus = "partial";
  } else if (donePlayers >= 2 && currentStatus === "partial") {
    newStatus = "complete";
  }

  if (newStatus) {
    match.set("status", newStatus);
    $app.save(match);
  }
}, "answers");
