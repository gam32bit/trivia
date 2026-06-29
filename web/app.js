// Local dev (file:// or localhost) talks to a separate PocketBase on :8090.
// In production the app is served by PocketBase itself, so use the same origin.
const PB_URL =
  location.protocol === "file:" ||
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1"
    ? "http://localhost:8090"
    : location.origin;
const pb = new PocketBase(PB_URL);

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

function escHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function avatarHtml(user, size) {
  size = size || 36;
  if (user?.profile_pic) {
    const url = `${pb.baseUrl}/api/files/users/${user.id}/${user.profile_pic}?thumb=${size}x${size}`;
    return `<img class="avatar" style="width:${size}px;height:${size}px" src="${url}" alt="">`;
  }
  const initial = escHtml((user?.display_name || "?").charAt(0).toUpperCase());
  return `<span class="avatar avatar-init" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px">${initial}</span>`;
}

function victoryImgHtml(user) {
  if (!user?.victory_pic) return "";
  return `<img class="victory-shot" src="${pb.baseUrl}/api/files/users/${user.id}/${user.victory_pic}" alt="">`;
}

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
      <h1>Lose'd League</h1>
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
    const oppRec = isA ? match.expand?.player_b : match.expand?.player_a;
    const opponentName = escHtml(oppRec?.display_name ?? "Opponent");

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
    const iSubmitted = myAnswerCount >= 5;
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
        <div class="vs-line">
          <div class="vs-player">${avatarHtml(me, 44)}<span>${escHtml(me.display_name)}</span></div>
          <span class="vs-sep">vs</span>
          <div class="vs-player">${avatarHtml(oppRec, 44)}<span>${opponentName}</span></div>
        </div>
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
          const opp = escHtml((m.player_a === me.id ? m.expand?.player_b : m.expand?.player_a)?.display_name ?? "Opponent");
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
        <span class="greeting">${avatarHtml(me, 30)} ${escHtml(me.display_name)}</span>
        <nav class="nav-actions">
          <button class="link-btn" id="leaderboard-btn">Leaderboard</button>
          <button class="link-btn" id="profile-btn">Profile</button>
          <button class="link-btn" id="logout-btn">Sign out</button>
        </nav>
      </header>
      ${todayBlock}
      ${recentHtml}
    </div>
  `);

  el("logout-btn").addEventListener("click", () => { pb.authStore.clear(); showLogin(); });
  el("leaderboard-btn").addEventListener("click", () => showLeaderboard());
  el("profile-btn").addEventListener("click", showProfile);
  if (el("play-btn")) el("play-btn").addEventListener("click", () => showPlay(match));
  if (el("results-btn")) el("results-btn").addEventListener("click", () => showResults(match.id));
  document.querySelectorAll(".recent-item").forEach((li) => {
    li.addEventListener("click", () => showResults(li.dataset.match));
  });
}

async function showPlay(match) {
  render(`<div class="card"><p class="loading">Loading questions…</p></div>`);

  const me = pb.authStore.model;
  const isA = match.player_a === me.id;
  const myRec = isA ? match.expand?.player_a : match.expand?.player_b;
  const oppRec = isA ? match.expand?.player_b : match.expand?.player_a;
  const playHeader = `<div class="play-vs">${avatarHtml(myRec, 28)}<span class="vs-sep">vs</span>${avatarHtml(oppRec, 28)}</div>`;

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
    const safeText = decodeEntities(q.text);
    const choiceHtml = ['True', 'False'].map(c =>
      `<button class="choice-btn tf-btn" data-choice="${c}">${c}</button>`
    ).join('');

    render(`
      <div class="card play-card">
        ${playHeader}
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

      // is_correct is computed server-side (answers_guard.pb.js) to prevent forgery.
      let isCorrect = false;
      try {
        const saved = await pb.collection("answers").create({
          match: match.id,
          player: pb.authStore.model.id,
          question: q.id,
          response,
        });
        isCorrect = saved.is_correct;
      } catch (err) {
        // 400 = duplicate submission blocked by a unique constraint — answer already saved.
        // Any other status (network error, 5xx) means the answer was NOT persisted; un-submit
        // so the player can tap again.
        if (err?.status !== 400) {
          submitted.delete(qIndex);
          el("choices").querySelectorAll(".choice-btn").forEach(b => {
            b.disabled = false;
            b.classList.remove("selected");
          });
          console.error("Answer create failed — allowing retry:", err);
          return;
        }
        console.warn("Answer create blocked (duplicate):", err);
      }

      // Show correct/incorrect feedback briefly then advance
      btn.classList.add(isCorrect ? "correct" : "wrong");
      if (!isCorrect) {
        // For T/F: the other button is the correct one
        el("choices").querySelectorAll(".choice-btn").forEach(b => {
          if (b !== btn) b.classList.add("correct");
        });
      }

      await new Promise(r => setTimeout(r, 900));

      qIndex++;
      if (qIndex < questions.length) {
        renderQuestion();
      } else {
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
              : `All done! Waiting for ${escHtml(opponentDoneName ?? "opponent")} to finish.`
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
  const myRec = isA ? match.expand?.player_a : match.expand?.player_b;
  const oppRec = isA ? match.expand?.player_b : match.expand?.player_a;
  const oppName = escHtml(oppRec?.display_name ?? "Opponent");
  const winnerRec = match.winner === match.player_a ? match.expand?.player_a
    : match.winner === match.player_b ? match.expand?.player_b : null;
  const oppTaunt = isA ? match.b_taunt : match.a_taunt;

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

  // label is always "You" (literal) or pre-escaped oppName — do not re-escape.
  const answerRow = (label, a) => {
    if (!a) return `<div class="ans-row"><span class="ans-who">${label}</span><span class="ans-resp muted">— no answer —</span></div>`;
    return `<div class="ans-row ${a.is_correct ? "ok" : "no"}">
      <span class="ans-who">${label}</span>
      <span class="ans-resp">${escHtml(a.response)}</span>
      <span class="mark">${a.is_correct ? "✓" : "✗"}</span>
    </div>`;
  };

  const rows = order.map((qid, i) => {
    const cell = byQuestion[qid] || {};
    const q = cell.q;
    const qText = q ? decodeEntities(q.text) : "(question unavailable)";
    // correct_answer is hidden from the REST API (migration 1784000002). For T/F
    // questions we can derive it from any recorded answer: if is_correct then their
    // response IS the answer; otherwise it's the other option.
    const anyAnswer = cell.mine || cell.theirs;
    const correct = anyAnswer
      ? (anyAnswer.is_correct ? anyAnswer.response : (anyAnswer.response === "True" ? "False" : "True"))
      : "";
    return `
      <div class="result-q">
        <div class="rq-text"><span class="rq-num">Q${i + 1}</span>${qText}</div>
        ${answerRow("You", cell.mine)}
        ${answerRow(oppName, cell.theirs)}
        ${correct ? `<div class="rq-correct">Answer: <strong>${correct}</strong>${correct === "True" && q?.source_url ? ` <a class="source-link" href="${escHtml(q.source_url)}" target="_blank" rel="noopener noreferrer">source</a>` : ""}</div>` : ""}
      </div>`;
  }).join("");

  const headline = oc.label === "Won" ? "You won 🏆"
    : oc.label === "Lost" ? "You lost"
    : oc.label === "Tied" ? "Tie game"
    : oc.label;

  // Victory pic and taunt display for both winner and loser.
  // Winners see their own victory pic + taunt_signature; losers see the winner's.
  const bannerImg = oc.label === "Won" ? victoryImgHtml(myRec)
    : oc.label === "Lost" ? victoryImgHtml(winnerRec)
    : "";
  const audioTauntUrl = oc.label === "Lost" && oppRec?.taunt_audio
    ? `${pb.baseUrl}/api/files/users/${oppRec.id}/${oppRec.taunt_audio}`
    : null;
  const audioTauntHtml = audioTauntUrl
    ? `<audio class="taunt-audio-player" controls src="${escHtml(audioTauntUrl)}"></audio>`
    : "";
  const winnerTaunt = oc.label === "Won" ? me.taunt_signature
    : oc.label === "Lost" ? (winnerRec?.taunt_signature || oppTaunt)
    : "";
  const tauntHtml = winnerTaunt
    ? `<div class="taunt-bubble theirs">"${escHtml(winnerTaunt)}"</div>`
    : "";

  render(`
    <div class="card results">
      <header>
        <button class="link-btn" id="back-btn">← Back</button>
        <span class="match-meta">Season ${match.season} · Round ${match.round}</span>
      </header>
      <div class="result-banner ${oc.cls}">
        ${bannerImg}
        <div class="rb-outcome">${headline}</div>
        <div class="rb-score">You ${myScore} — ${oppName} ${oppScore}</div>
        ${tauntHtml}
        ${audioTauntHtml}
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
      <td class="lb-name">${escHtml(r.name)}</td>
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
    const nameA = escHtml(m.expand?.player_a?.display_name ?? "?");
    const nameB = escHtml(m.expand?.player_b?.display_name ?? "?");
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

async function showProfile() {
  const me = pb.authStore.model;
  const profUrl = me.profile_pic ? `${pb.baseUrl}/api/files/users/${me.id}/${me.profile_pic}` : null;
  const vicUrl = me.victory_pic ? `${pb.baseUrl}/api/files/users/${me.id}/${me.victory_pic}` : null;
  const existingAudioUrl = me.taunt_audio ? `${pb.baseUrl}/api/files/users/${me.id}/${me.taunt_audio}` : null;
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  let audioBlob = null;
  let audioBlobUrl = null;
  let clearAudio = false;
  let mediaRecorder = null;
  let recordStream = null;
  let chunks = [];
  let timerInterval = null;
  let recSeconds = 0;
  let micDenied = false;

  render(`
    <div class="card profile-card">
      <header>
        <button class="link-btn" id="back-btn">← Back</button>
        <span>Profile</span>
      </header>
      <form id="profile-form">
        <label class="field-label">
          Display name
          <input type="text" id="disp-name" placeholder="Your name" maxlength="80" value="${escHtml(me.display_name || "")}">
        </label>
        <div class="photo-pair">
          <div class="photo-slot">
            <div class="photo-label">Profile photo</div>
            ${profUrl
              ? `<img class="photo-preview" id="prof-preview" src="${profUrl}" alt="">`
              : `<div class="photo-placeholder" id="prof-preview">No photo</div>`}
            <label class="upload-label">Change<input type="file" id="prof-input" accept="image/*" hidden></label>
          </div>
          <div class="photo-slot">
            <div class="photo-label">Victory photo</div>
            ${vicUrl
              ? `<img class="photo-preview" id="vic-preview" src="${vicUrl}" alt="">`
              : `<div class="photo-placeholder" id="vic-preview">No photo</div>`}
            <label class="upload-label">Change<input type="file" id="vic-input" accept="image/*" hidden></label>
          </div>
        </div>
        <label class="field-label">
          Victory taunt
          <input type="text" id="taunt-sig" placeholder="What do you say when you win?" maxlength="200" value="${escHtml(me.taunt_signature || "")}">
        </label>
        <div class="field-label">
          Victory taunt audio
          <div id="audio-section"></div>
        </div>
        <p id="profile-status" class="profile-status"></p>
        <button type="submit" class="play-btn">Save</button>
      </form>

      <div class="pw-section">
        <div class="section-divider">Change Password</div>
        <form id="pw-form">
          <label class="field-label">Current password<input type="password" id="old-pw" autocomplete="current-password"></label>
          <label class="field-label">New password<input type="password" id="new-pw" autocomplete="new-password"></label>
          <label class="field-label">Confirm new password<input type="password" id="confirm-pw" autocomplete="new-password"></label>
          <p id="pw-status" class="profile-status"></p>
          <button type="submit" class="play-btn">Update password</button>
        </form>
      </div>
    </div>
  `);

  function renderAudioSection() {
    const section = el("audio-section");
    if (!section) return;
    let html = "";

    if (audioBlob && audioBlobUrl) {
      html += `<audio class="taunt-audio-player" controls src="${audioBlobUrl}"></audio>
               <button type="button" class="link-btn danger-link" id="discard-audio-btn">Discard recording</button>`;
    } else if (existingAudioUrl && !clearAudio) {
      html += `<audio class="taunt-audio-player" controls src="${existingAudioUrl}"></audio>
               <button type="button" class="link-btn danger-link" id="clear-audio-btn">Delete audio</button>`;
    }

    if (micDenied) {
      html += `<span class="muted-note">Microphone access denied — allow it in your browser settings, then <button type="button" class="link-btn" id="retry-mic-btn">try again</button>.</span>`;
    } else if (canRecord && !mediaRecorder && !audioBlob) {
      html += `<button type="button" class="record-btn" id="record-btn">🎤 Record</button>`;
    } else if (mediaRecorder) {
      html += `<button type="button" class="record-btn recording" id="stop-btn">⏹ Stop (<span id="rec-timer">0:00</span>)</button>`;
    } else if (!canRecord) {
      html += `<span class="muted-note">Audio recording requires HTTPS</span>`;
    }

    section.innerHTML = html;
    wireAudioSection();
  }

  function wireAudioSection() {
    el("record-btn")?.addEventListener("click", startRecording);
    el("stop-btn")?.addEventListener("click", stopRecording);
    el("retry-mic-btn")?.addEventListener("click", () => { micDenied = false; renderAudioSection(); });
    el("clear-audio-btn")?.addEventListener("click", () => {
      clearAudio = true;
      renderAudioSection();
    });
    el("discard-audio-btn")?.addEventListener("click", () => {
      if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
      audioBlob = null;
      audioBlobUrl = null;
      renderAudioSection();
    });
  }

  async function startRecording() {
    try {
      recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      micDenied = true;
      renderAudioSection();
      return;
    }

    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(
      (t) => MediaRecorder.isTypeSupported(t)
    ) || "";

    chunks = [];
    mediaRecorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const type = mediaRecorder.mimeType || "audio/webm";
      if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
      audioBlob = new Blob(chunks, { type });
      audioBlobUrl = URL.createObjectURL(audioBlob);
      mediaRecorder = null;
      recordStream.getTracks().forEach((t) => t.stop());
      recordStream = null;
      clearInterval(timerInterval);
      timerInterval = null;
      renderAudioSection();
    };

    recSeconds = 0;
    mediaRecorder.start();
    renderAudioSection();

    timerInterval = setInterval(() => {
      recSeconds++;
      const timerEl = el("rec-timer");
      if (timerEl) {
        const m = Math.floor(recSeconds / 60);
        const s = recSeconds % 60;
        timerEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
      }
    }, 1000);
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  }

  renderAudioSection();

  function attachPreview(inputId, previewId) {
    el(inputId).addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const node = el(previewId);
        if (!node) return;
        if (node.tagName === "IMG") {
          node.src = ev.target.result;
        } else {
          const img = document.createElement("img");
          img.className = "photo-preview";
          img.id = previewId;
          img.alt = "";
          img.src = ev.target.result;
          node.replaceWith(img);
        }
      };
      reader.readAsDataURL(f);
    });
  }

  attachPreview("prof-input", "prof-preview");
  attachPreview("vic-input", "vic-preview");

  el("back-btn").addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    if (recordStream) recordStream.getTracks().forEach((t) => t.stop());
    clearInterval(timerInterval);
    if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
    showDashboard();
  });

  el("profile-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector("button[type='submit']");
    const status = el("profile-status");
    btn.disabled = true;
    status.textContent = "";
    status.style.color = "";

    const fd = new FormData();
    const profFile = el("prof-input").files[0];
    const vicFile = el("vic-input").files[0];
    if (profFile) fd.append("profile_pic", profFile);
    if (vicFile) fd.append("victory_pic", vicFile);
    fd.append("taunt_signature", el("taunt-sig").value.trim());
    fd.append("display_name", el("disp-name").value.trim());

    if (audioBlob) {
      const type = audioBlob.type || "audio/webm";
      const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
      fd.append("taunt_audio", audioBlob, `taunt.${ext}`);
    }

    try {
      if (clearAudio && !audioBlob) {
        await pb.collection("users").update(me.id, { taunt_audio: null });
      }
      await pb.collection("users").update(me.id, fd);
      await pb.collection("users").authRefresh();
      status.textContent = "Saved!";
      status.style.color = "var(--correct)";
    } catch (err) {
      status.textContent = "Save failed.";
      status.style.color = "var(--wrong)";
      console.error(err);
    }
    btn.disabled = false;
  });

  el("pw-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector("button[type='submit']");
    const status = el("pw-status");
    const oldPw = el("old-pw").value;
    const newPw = el("new-pw").value;
    const confirmPw = el("confirm-pw").value;

    if (!oldPw || !newPw || !confirmPw) {
      status.textContent = "All password fields are required.";
      status.style.color = "var(--wrong)";
      return;
    }
    if (newPw !== confirmPw) {
      status.textContent = "New passwords don't match.";
      status.style.color = "var(--wrong)";
      return;
    }
    if (newPw.length < 8) {
      status.textContent = "Password must be at least 8 characters.";
      status.style.color = "var(--wrong)";
      return;
    }

    btn.disabled = true;
    status.textContent = "";
    status.style.color = "";

    try {
      const userEmail = pb.authStore.model.email;
      await pb.collection("users").update(me.id, {
        oldPassword: oldPw,
        password: newPw,
        passwordConfirm: confirmPw,
      });
      await pb.collection("users").authWithPassword(userEmail, newPw);
      status.textContent = "Password updated!";
      status.style.color = "var(--correct)";
      el("old-pw").value = "";
      el("new-pw").value = "";
      el("confirm-pw").value = "";
    } catch (err) {
      const msg = err?.data?.message || err?.message || "Update failed.";
      status.textContent = msg;
      status.style.color = "var(--wrong)";
      console.error(err);
    }
    btn.disabled = false;
  });
}

// ---------- boot ----------

if (pb.authStore.isValid) {
  showDashboard();
} else {
  showLogin();
}
