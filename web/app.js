const pb = new PocketBase("http://localhost:8090");

// ---------- helpers ----------

function todayET() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'");
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function el(id) { return document.getElementById(id); }

function render(html) {
  el("app").innerHTML = html;
}

// ---------- views ----------

function showLogin(errorMsg) {
  render(`
    <div class="card login-card">
      <h1>Trivia League</h1>
      ${errorMsg ? `<p class="error">${errorMsg}</p>` : ""}
      <form id="login-form">
        <label>Email<input type="email" id="email" required autocomplete="username"></label>
        <label>Password<input type="password" id="password" required autocomplete="current-password"></label>
        <button type="submit">Sign in</button>
      </form>
    </div>
  `);

  el("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = el("login-form").querySelector("button");
    btn.disabled = true;
    try {
      await pb.collection("users").authWithPassword(el("email").value, el("password").value);
      showDashboard();
    } catch {
      showLogin("Invalid email or password.");
    }
  });
}

async function showDashboard() {
  render(`<div class="card"><p class="loading">Loading…</p></div>`);

  const me = pb.authStore.model;
  const today = todayET();
  const tomorrow = new Date(today + "T00:00:00");
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  let match, myAnswerCount;
  try {
    const result = await pb.collection("matches").getList(1, 1, {
      filter: `match_date >= "${today} 00:00:00.000Z" && match_date < "${tomorrowStr} 00:00:00.000Z"`,
      expand: "player_a,player_b",
    });
    match = result.items[0] || null;
  } catch {
    match = null;
  }

  if (!match) {
    render(`
      <div class="card dashboard">
        <header>
          <span class="greeting">Hi, ${me.display_name}</span>
          <button class="link-btn" id="logout-btn">Sign out</button>
        </header>
        <p class="no-match">No match scheduled for today.</p>
      </div>
    `);
    el("logout-btn").addEventListener("click", () => { pb.authStore.clear(); showLogin(); });
    return;
  }

  // Who is the opponent?
  const isA = match.player_a === me.id;
  const opponentRecord = isA ? match.expand?.player_b : match.expand?.player_a;
  const opponentName = opponentRecord?.display_name ?? "Opponent";

  // Count my submitted answers for this match
  try {
    const ans = await pb.collection("answers").getList(1, 10, {
      filter: `match = "${match.id}" && player = "${me.id}"`,
      fields: "id",
    });
    myAnswerCount = ans.totalItems;
  } catch {
    myAnswerCount = 0;
  }

  const iSubmitted = myAnswerCount >= 3;
  const status = match.status;

  let statusBlock;
  if (status === "complete" || status === "forfeit") {
    statusBlock = `<p class="status-msg complete">Match complete — results coming in Phase 3.</p>`;
  } else if (iSubmitted) {
    statusBlock = `<p class="status-msg waiting">Waiting on ${opponentName}…</p>`;
  } else {
    statusBlock = `<button class="play-btn" id="play-btn">Play today's match</button>`;
  }

  render(`
    <div class="card dashboard">
      <header>
        <span class="greeting">Hi, ${me.display_name}</span>
        <button class="link-btn" id="logout-btn">Sign out</button>
      </header>
      <div class="match-summary">
        <div class="vs-line">vs. <strong>${opponentName}</strong></div>
        <div class="match-meta">Season ${match.season} · Round ${match.round}</div>
      </div>
      ${statusBlock}
    </div>
  `);

  el("logout-btn").addEventListener("click", () => { pb.authStore.clear(); showLogin(); });
  if (!iSubmitted && status !== "complete" && status !== "forfeit") {
    el("play-btn").addEventListener("click", () => showPlay(match));
  }
}

async function showPlay(match) {
  render(`<div class="card"><p class="loading">Loading questions…</p></div>`);

  const questionIds = match.questions;
  let questions;
  try {
    questions = await Promise.all(questionIds.map(id => pb.collection("questions").getOne(id)));
  } catch {
    render(`<div class="card"><p class="error">Failed to load questions. <button id="back-btn">Back</button></p></div>`);
    el("back-btn").addEventListener("click", showDashboard);
    return;
  }

  let qIndex = 0;
  const submitted = new Set();

  function renderQuestion() {
    const q = questions[qIndex];
    const choices = shuffle([q.correct_answer, ...q.incorrect_answers]);
    const safeText = decodeEntities(q.text);
    const choiceHtml = choices.map(c => {
      const decoded = decodeEntities(c);
      return `<button class="choice-btn" data-choice="${encodeURIComponent(c)}">${decoded}</button>`;
    }).join("");

    render(`
      <div class="card play-card">
        <div class="q-progress">Question ${qIndex + 1} of ${questions.length}</div>
        <div class="q-text">${safeText}</div>
        <div class="choices" id="choices">${choiceHtml}</div>
      </div>
    `);

    el("choices").addEventListener("click", async (ev) => {
      const btn = ev.target.closest(".choice-btn");
      if (!btn || submitted.has(qIndex)) return;
      submitted.add(qIndex);

      // Disable all choices immediately
      el("choices").querySelectorAll(".choice-btn").forEach(b => b.disabled = true);
      btn.classList.add("selected");

      const response = decodeURIComponent(btn.dataset.choice);
      const isCorrect = response === q.correct_answer;

      try {
        await pb.collection("answers").create({
          match: match.id,
          player: pb.authStore.model.id,
          question: q.id,
          response,
          is_correct: isCorrect,
        });
      } catch (err) {
        // Duplicate submission blocked by server — treat as already done
        console.warn("Answer create failed (likely duplicate):", err);
      }

      // Show correct/incorrect feedback briefly then advance
      btn.classList.add(isCorrect ? "correct" : "wrong");
      if (!isCorrect) {
        el("choices").querySelectorAll(".choice-btn").forEach(b => {
          if (decodeURIComponent(b.dataset.choice) === q.correct_answer) b.classList.add("correct");
        });
      }

      await new Promise(r => setTimeout(r, 900));

      qIndex++;
      if (qIndex < questions.length) {
        renderQuestion();
      } else {
        const me = pb.authStore.model;
        const opponentDoneName = me.id === match.player_a
          ? match.expand?.player_b?.display_name
          : match.expand?.player_a?.display_name;
        render(`
          <div class="card">
            <p class="done-msg">All done! Waiting for ${opponentDoneName ?? "opponent"} to finish.</p>
            <button id="dash-btn" class="play-btn">Back to dashboard</button>
          </div>
        `);
        el("dash-btn").addEventListener("click", showDashboard);
      }
    });
  }

  renderQuestion();
}

// ---------- boot ----------

if (pb.authStore.isValid) {
  showDashboard();
} else {
  showLogin();
}
