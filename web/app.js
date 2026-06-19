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

// Outcome of a completed match from `meId`'s perspective. The winner relation is
// authoritative (set server-side by the scoring hook); empty winner on a
// complete match means a tie.
function outcomeFor(match, meId) {
  if (match.status === "forfeit" && !match.winner) return { label: "Forfeit", cls: "tie" };
  if (match.winner === meId) return { label: "Won", cls: "win" };
  if (match.winner) return { label: "Lost", cls: "loss" };
  return { label: "Tied", cls: "tie" };
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

  // --- Today's match ---
  let match = null;
  try {
    const result = await pb.collection("matches").getList(1, 1, {
      filter: `match_date >= "${today} 00:00:00.000Z" && match_date < "${tomorrowStr} 00:00:00.000Z"`,
      expand: "player_a,player_b",
    });
    match = result.items[0] || null;
  } catch {
    match = null;
  }

  let todayBlock;
  if (!match) {
    todayBlock = `<p class="no-match">No match scheduled for today.</p>`;
  } else {
    const isA = match.player_a === me.id;
    const opponentName = (isA ? match.expand?.player_b : match.expand?.player_a)?.display_name ?? "Opponent";

    let myAnswerCount = 0;
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
      statusBlock = `<button class="play-btn" id="results-btn">See results</button>`;
    } else if (iSubmitted) {
      statusBlock = `<p class="status-msg waiting">Waiting on ${opponentName}…</p>`;
    } else {
      statusBlock = `<button class="play-btn" id="play-btn">Play today's match</button>`;
    }

    todayBlock = `
      <div class="match-summary">
        <div class="vs-line">vs. <strong>${opponentName}</strong></div>
        <div class="match-meta">Season ${match.season} · Round ${match.round}</div>
      </div>
      ${statusBlock}`;
  }

  // --- Recent results (my completed matches) ---
  let recent = [];
  try {
    const r = await pb.collection("matches").getList(1, 10, {
      filter: `(status = "complete" || status = "forfeit") && (player_a = "${me.id}" || player_b = "${me.id}")`,
      sort: "-match_date",
      expand: "player_a,player_b",
    });
    recent = r.items;
  } catch {
    recent = [];
  }

  const recentHtml = recent.length ? `
    <div class="recent">
      <h2>Recent results</h2>
      <ul class="recent-list">
        ${recent.map((m) => {
          const opp = (m.player_a === me.id ? m.expand?.player_b : m.expand?.player_a)?.display_name ?? "Opponent";
          const oc = outcomeFor(m, me.id);
          return `<li class="recent-item" data-match="${m.id}">
            <span class="recent-opp">vs ${opp}</span>
            <span class="outcome ${oc.cls}">${oc.label}</span>
          </li>`;
        }).join("")}
      </ul>
    </div>` : "";

  render(`
    <div class="card dashboard">
      <header>
        <span class="greeting">Hi, ${me.display_name}</span>
        <nav class="nav-actions">
          <button class="link-btn" id="leaderboard-btn">Leaderboard</button>
          <button class="link-btn" id="logout-btn">Sign out</button>
        </nav>
      </header>
      ${todayBlock}
      ${recentHtml}
    </div>
  `);

  el("logout-btn").addEventListener("click", () => { pb.authStore.clear(); showLogin(); });
  el("leaderboard-btn").addEventListener("click", () => showLeaderboard());
  if (el("play-btn")) el("play-btn").addEventListener("click", () => showPlay(match));
  if (el("results-btn")) el("results-btn").addEventListener("click", () => showResults(match.id));
  document.querySelectorAll(".recent-item").forEach((li) => {
    li.addEventListener("click", () => showResults(li.dataset.match));
  });
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

        // Refetch match to see if the opponent already finished
        let freshMatch = match;
        try { freshMatch = await pb.collection("matches").getOne(match.id); } catch {}
        const matchDone = freshMatch.status === "complete" || freshMatch.status === "forfeit";

        render(`
          <div class="card">
            <p class="done-msg">${matchDone
              ? "Match complete! Both players have submitted."
              : `All done! Waiting for ${opponentDoneName ?? "opponent"} to finish.`
            }</p>
            <button id="dash-btn" class="play-btn">Back to dashboard</button>
          </div>
        `);
        el("dash-btn").addEventListener("click", showDashboard);
      }
    });
  }

  renderQuestion();
}

async function showResults(matchId) {
  render(`<div class="card"><p class="loading">Loading results…</p></div>`);
  const me = pb.authStore.model;

  let match;
  try {
    match = await pb.collection("matches").getOne(matchId, { expand: "player_a,player_b" });
  } catch {
    render(`<div class="card"><p class="error">Couldn't load that match.</p><button class="play-btn" id="back-btn">Back</button></div>`);
    el("back-btn").addEventListener("click", showDashboard);
    return;
  }

  let answers = [];
  try {
    answers = await pb.collection("answers").getFullList({
      filter: `match = "${matchId}"`,
      expand: "question,player",
    });
  } catch {
    answers = [];
  }

  const isA = match.player_a === me.id;
  const oppName = (isA ? match.expand?.player_b : match.expand?.player_a)?.display_name ?? "Opponent";

  // Group answers by question, splitting mine vs. opponent's.
  const byQuestion = {};
  let myScore = 0, oppScore = 0;
  for (const a of answers) {
    const cell = (byQuestion[a.question] = byQuestion[a.question] || {});
    cell.q = a.expand?.question;
    if (a.player === me.id) { cell.mine = a; if (a.is_correct) myScore++; }
    else { cell.theirs = a; if (a.is_correct) oppScore++; }
  }

  const order = match.questions && match.questions.length ? match.questions : Object.keys(byQuestion);
  const oc = outcomeFor(match, me.id);

  const answerRow = (label, a) => {
    if (!a) return `<div class="ans-row"><span class="ans-who">${label}</span><span class="ans-resp muted">— no answer —</span></div>`;
    return `<div class="ans-row ${a.is_correct ? "ok" : "no"}">
      <span class="ans-who">${label}</span>
      <span class="ans-resp">${decodeEntities(a.response)}</span>
      <span class="mark">${a.is_correct ? "✓" : "✗"}</span>
    </div>`;
  };

  const rows = order.map((qid, i) => {
    const cell = byQuestion[qid] || {};
    const q = cell.q;
    const qText = q ? decodeEntities(q.text) : "(question unavailable)";
    const correct = q ? decodeEntities(q.correct_answer) : "";
    return `
      <div class="result-q">
        <div class="rq-text"><span class="rq-num">Q${i + 1}</span>${qText}</div>
        ${answerRow("You", cell.mine)}
        ${answerRow(oppName, cell.theirs)}
        ${correct ? `<div class="rq-correct">Answer: <strong>${correct}</strong></div>` : ""}
      </div>`;
  }).join("");

  const headline = oc.label === "Won" ? "You won 🏆"
    : oc.label === "Lost" ? "You lost"
    : oc.label === "Tied" ? "Tie game"
    : oc.label;

  render(`
    <div class="card results">
      <header>
        <button class="link-btn" id="back-btn">← Back</button>
        <span class="match-meta">Season ${match.season} · Round ${match.round}</span>
      </header>
      <div class="result-banner ${oc.cls}">
        <div class="rb-outcome">${headline}</div>
        <div class="rb-score">You ${myScore} — ${oppName} ${oppScore}</div>
      </div>
      <div class="result-list">${rows}</div>
    </div>
  `);
  el("back-btn").addEventListener("click", showDashboard);
}

async function showLeaderboard(season) {
  render(`<div class="card"><p class="loading">Loading leaderboard…</p></div>`);
  const me = pb.authStore.model;

  // Derive all seasons that have matches (deduplicate client-side).
  let allSeasons = [];
  try {
    const r = await pb.collection("matches").getFullList({ fields: "season", sort: "season" });
    allSeasons = [...new Set(r.map(m => m.season))].sort((a, b) => a - b);
  } catch {}

  if (season == null) {
    season = allSeasons.length ? allSeasons[allSeasons.length - 1] : 1;
  }

  let standings = [], users = [], seasonMatches = [];
  await Promise.all([
    pb.collection("standings").getFullList({ filter: `season = ${season}` })
      .then(r => { standings = r; }).catch(() => {}),
    pb.collection("users").getFullList({ fields: "id,display_name" })
      .then(r => { users = r; }).catch(() => {}),
    pb.collection("matches").getFullList({
      filter: `season = ${season}`,
      sort: "round,player_a",
      expand: "player_a,player_b",
    }).then(r => { seasonMatches = r; }).catch(() => {}),
  ]);

  // Standings table
  const byPlayer = {};
  for (const s of standings) byPlayer[s.player] = s;
  const rows = users.map((u) => {
    const s = byPlayer[u.id] || {};
    return {
      id: u.id,
      name: u.display_name,
      wins: s.wins || 0, ties: s.ties || 0, losses: s.losses || 0, points: s.points || 0,
    };
  });
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));

  const lbBody = rows.map((r, i) => `
    <tr class="${r.id === me.id ? "me" : ""}">
      <td class="rank">${i + 1}</td>
      <td class="lb-name">${r.name}</td>
      <td>${r.wins}</td>
      <td>${r.ties}</td>
      <td>${r.losses}</td>
      <td class="lb-pts">${r.points}</td>
    </tr>`).join("");

  // Season selector tabs (only shown when more than one season exists)
  const seasonTabs = allSeasons.length > 1 ? `
    <div class="season-tabs">
      ${allSeasons.map(s => `<button class="season-tab${s === season ? " active" : ""}" data-season="${s}">Season ${s}</button>`).join("")}
    </div>` : "";

  // Match history for this season
  const matchRows = seasonMatches.map(m => {
    const nameA = m.expand?.player_a?.display_name ?? "?";
    const nameB = m.expand?.player_b?.display_name ?? "?";
    const isMe = m.player_a === me.id || m.player_b === me.id;
    const done = m.status === "complete" || m.status === "forfeit";

    let ocCell;
    if (!done) {
      ocCell = `<span class="muted">${m.status}</span>`;
    } else if (isMe) {
      const oc = outcomeFor(m, me.id);
      ocCell = `<span class="outcome ${oc.cls}">${oc.label}</span>`;
    } else {
      // Not my match — show which side won using already-expanded player names
      const winnerName = m.winner === m.player_a ? nameA : (m.winner === m.player_b ? nameB : null);
      ocCell = winnerName
        ? `<span class="muted">${winnerName}</span>`
        : `<span class="muted">Tie</span>`;
    }

    const clickable = isMe && done;
    return `<tr class="match-row${clickable ? " clickable" : ""}"${clickable ? ` data-match="${m.id}"` : ""}>
      <td class="rnd">R${m.round}</td>
      <td>${nameA} vs ${nameB}</td>
      <td>${ocCell}</td>
    </tr>`;
  }).join("");

  render(`
    <div class="card leaderboard">
      <header>
        <button class="link-btn" id="back-btn">← Back</button>
        <span class="match-meta">Season ${season}</span>
      </header>
      <h1>Leaderboard</h1>
      ${seasonTabs}
      <h2>Standings</h2>
      <table class="lb-table">
        <thead><tr><th>#</th><th>Player</th><th>W</th><th>T</th><th>L</th><th>Pts</th></tr></thead>
        <tbody>${lbBody}</tbody>
      </table>
      <h2>Matches</h2>
      <table class="lb-table match-hist">
        <thead><tr><th>Rnd</th><th>Matchup</th><th>Result</th></tr></thead>
        <tbody>${matchRows}</tbody>
      </table>
    </div>
  `);

  el("back-btn").addEventListener("click", showDashboard);
  document.querySelectorAll(".season-tab").forEach(btn => {
    btn.addEventListener("click", () => showLeaderboard(+btn.dataset.season));
  });
  document.querySelectorAll(".match-row.clickable").forEach(row => {
    row.addEventListener("click", () => showResults(row.dataset.match));
  });
}

// ---------- boot ----------

if (pb.authStore.isValid) {
  showDashboard();
} else {
  showLogin();
}
