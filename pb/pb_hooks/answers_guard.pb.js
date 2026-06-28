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
  } catch (_) {
    // Unknown question — leave is_correct false
  }

  e.record.set("is_correct", isCorrect);
  e.next();
}, "answers");
