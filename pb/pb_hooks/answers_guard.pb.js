// Security: compute is_correct server-side before persisting an answer.
// Prevents clients from forging is_correct=true to inflate their score.
// The hook loads the question and compares the submitted response to the
// stored correct_answer (accessible server-side even though the field is
// hidden from the REST API).
onRecordCreateRequest((e) => {
  const questionId = e.record.getString("question");
  const response = e.record.getString("response");

  let isCorrect = false;
  try {
    const question = $app.findRecordById("questions", questionId);
    isCorrect = response === question.getString("correct_answer");
  } catch (err) {
    const msg = String(err);
    if (msg.includes("no rows") || msg.includes("not found") || msg.includes("NoResultsError")) {
      // Unknown question ID — leave is_correct false
    } else {
      // Transient DB error: re-throw so the client gets an error rather than a
      // silent wrong mark. The answer is not persisted.
      throw err;
    }
  }

  e.record.set("is_correct", isCorrect);
  e.next();
}, "answers");
