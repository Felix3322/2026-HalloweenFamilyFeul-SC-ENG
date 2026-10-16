(() => {
  "use strict";

  const STORAGE_KEY = "family-fuel-halloween-state-v2";
  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const PRESETS = {
    halloween_party: {
      label: "Halloween Party",
      question: "Name something you might see at a Halloween party",
      answers: [
        ["Pumpkin", 34], ["Candy", 22], ["Costume", 16], ["Bats", 11],
        ["Spider web", 8], ["Witch hat", 5], ["Skeleton", 3], ["Haunted house", 1]
      ]
    },
    campus_night: {
      label: "Campus Night",
      question: "Name something students bring to a school game night",
      answers: [
        ["Snacks", 31], ["Friends", 24], ["Phone", 15], ["Team shirt", 10],
        ["Water bottle", 8], ["Backpack", 6], ["Notebook", 4], ["Camera", 2]
      ]
    },
    school_spirit: {
      label: "School Spirit",
      question: "Name something that makes a school event feel special",
      answers: [
        ["Music", 29], ["Mascot", 21], ["Crowd", 17], ["Decorations", 12],
        ["Prizes", 9], ["Games", 6], ["Photos", 4], ["Teachers", 2]
      ]
    },
    snack_table: {
      label: "Snack Table",
      question: "Name a snack students hope to find at a party",
      answers: [
        ["Pizza", 27], ["Chips", 20], ["Cupcakes", 17], ["Popcorn", 13],
        ["Cookies", 10], ["Fruit", 6], ["Pretzels", 4], ["Brownies", 3]
      ]
    },
    movie_night: {
      label: "Movie Night",
      question: "Name something people do during a school movie night",
      answers: [
        ["Laugh", 26], ["Eat popcorn", 23], ["Pick a seat", 17], ["Talk quietly", 11],
        ["Quote the movie", 9], ["Take photos", 6], ["Get cozy", 5], ["Fall asleep", 3]
      ]
    },
    test_round: {
      label: "Test Round",
      question: "Name something students bring to a Halloween game night.",
      answers: [
        ["Snacks", 30], ["Friends", 22], ["Phone", 15], ["Costume", 12],
        ["Water bottle", 8], ["Team shirt", 6], ["Backpack", 4], ["Camera", 3]
      ]
    }
  };

  const defaultState = {
    question: PRESETS.halloween_party.question,
    round: 1,
    status: "Ready",
    activeTeam: "A",
    sound: true,
    motion: true,
    selfRun: false,
    setupComplete: false,
    strikes: 0,
    countdown: 0,
    revealStreak: 0,
    outcome: "none",
    roundAwarded: false,
    teamA: { name: "Blue Team", score: 0, avatar: "🎃" },
    teamB: { name: "Orange Team", score: 0, avatar: "👻" },
    rewardName: "Halloween Treat",
    roster: [],
    answers: PRESETS.halloween_party.answers.map(([text, points]) => ({ text, points, revealed: false }))
  };

  let state = loadState();
  let audioCtx;
  let audioMaster;
  let noiseBuffer;
  const activeVoices = new Set();
  const MAX_ACTIVE_VOICES = 48;
  let toastTimer;
  let countdownTimer = null;
  let overlayTimer = null;

  function normalizeState(candidate) {
    const incoming = candidate && typeof candidate === "object" ? candidate : {};
    const base = clone(defaultState);
    const rawAnswers = Array.isArray(incoming.answers) ? incoming.answers : base.answers;
    const answers = rawAnswers.filter(Boolean).map((answer) => ({
      text: String(answer.text ?? ""),
      points: Math.max(0, Number(answer.points) || 0),
      revealed: Boolean(answer.revealed)
    }));
    const rawRoster = Array.isArray(incoming.roster) ? incoming.roster : [];
    const roster = rawRoster.map((entry) => typeof entry === "string" ? ({ name: entry, rewarded: false }) : ({ name: String(entry?.name ?? ""), rewarded: Boolean(entry?.rewarded) })).filter((entry) => entry.name.trim());
    return {
      ...base,
      ...incoming,
      teamA: { ...base.teamA, ...(incoming.teamA || {}) },
      teamB: { ...base.teamB, ...(incoming.teamB || {}) },
      setupComplete: Boolean(incoming.setupComplete),
      answers: answers.length ? answers : clone(base.answers),
      roster,
      roundAwarded: Boolean(incoming.roundAwarded),
      countdown: Math.max(0, Number(incoming.countdown) || 0),
      revealStreak: Math.max(0, Number(incoming.revealStreak) || 0)
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeState(JSON.parse(raw)) : clone(defaultState);
    } catch (_) {
      return clone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const saveStatus = $("saveStatus");
    if (saveStatus) saveStatus.textContent = "● Saved locally";
  }

  function toast(message) {
    const node = $("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.classList.remove("show"), 2200);
  }

  // The game uses short, synthesized cues so it stays fully offline.  The
  // context is created only after a user gesture (see installAudioUnlock),
  // which keeps browsers' autoplay policies happy.
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    try {
      audioCtx = new AudioContextCtor();
      audioMaster = audioCtx.createGain();
      audioMaster.gain.value = 0.28;
      audioMaster.connect(audioCtx.destination);
      return audioCtx;
    } catch (_) {
      audioCtx = null;
      audioMaster = null;
      return null;
    }
  }

  function unlockAudio() {
    const ctx = ensureAudio();
    if (ctx?.state === "suspended") resumeAudio(ctx);
  }

  function resumeAudio(ctx) {
    try {
      const result = ctx?.resume?.();
      result?.catch?.(() => {});
    } catch (_) { /* Some embedded browsers expose a non-Promise resume. */ }
  }

  function trackVoice(voice, stopAt) {
    activeVoices.add(voice);
    trimVoices();
    voice.osc.onended = () => {
      activeVoices.delete(voice);
      try { voice.osc.disconnect(); } catch (_) { /* already disconnected */ }
      try { voice.gain.disconnect(); } catch (_) { /* already disconnected */ }
      if (voice.source) {
        try { voice.source.disconnect(); } catch (_) { /* already disconnected */ }
      }
      if (voice.filter) {
        try { voice.filter.disconnect(); } catch (_) { /* already disconnected */ }
      }
    };
    voice.osc.start(voice.startAt);
    voice.osc.stop(stopAt);
  }

  function trimVoices() {
    while (activeVoices.size > MAX_ACTIVE_VOICES) {
      const oldest = activeVoices.values().next().value;
      if (!oldest) break;
      activeVoices.delete(oldest);
      try { oldest.osc.stop(); } catch (_) { /* already stopped */ }
    }
  }

  function scheduleTone(frequency, startAt, duration, peak = 0.07, wave = "triangle", endFrequency = frequency) {
    if (!audioCtx || !audioMaster) return;
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const endAt = startAt + Math.max(0.035, duration);
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(Math.max(1, frequency), startAt);
    if (endFrequency !== frequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), endAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, peak), startAt + Math.min(0.018, duration * 0.22));
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
    oscillator.connect(gain).connect(audioMaster);
    const voice = { osc: oscillator, gain, startAt };
    trackVoice(voice, endAt + 0.025);
  }

  function getNoiseBuffer() {
    if (!audioCtx) return null;
    if (noiseBuffer && noiseBuffer.sampleRate === audioCtx.sampleRate) return noiseBuffer;
    const length = Math.max(1, Math.floor(audioCtx.sampleRate * 0.55));
    noiseBuffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2) - 1;
    return noiseBuffer;
  }

  function scheduleNoise(startAt, duration = 0.11, peak = 0.045, highpass = 900) {
    if (!audioCtx || !audioMaster) return;
    const source = audioCtx.createBufferSource();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();
    const endAt = startAt + Math.max(0.035, duration);
    source.buffer = getNoiseBuffer();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(highpass, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, peak), startAt + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
    source.connect(filter).connect(gain).connect(audioMaster);
    const voice = { osc: source, source, filter, gain, startAt };
    // Buffer sources expose the same start/stop/onended lifecycle as oscillators.
    activeVoices.add(voice);
    trimVoices();
    source.onended = () => {
      activeVoices.delete(voice);
      try { source.disconnect(); } catch (_) { /* already disconnected */ }
      try { filter.disconnect(); } catch (_) { /* already disconnected */ }
      try { gain.disconnect(); } catch (_) { /* already disconnected */ }
    };
    source.start(startAt);
    source.stop(endAt + 0.02);
  }

  function playTone(type = "tap") {
    if (!state.sound) return;
    const ctx = ensureAudio();
    if (!ctx || !audioMaster) return;
    if (ctx.state === "suspended") resumeAudio(ctx);
    const now = ctx.currentTime + 0.008;
    try {
      switch (type) {
        case "reveal":
          scheduleTone(523.25, now, 0.16, 0.065, "triangle", 659.25);
          scheduleTone(783.99, now + 0.07, 0.22, 0.048, "sine", 1046.5);
          scheduleNoise(now, 0.055, 0.018, 2400);
          break;
        case "streak":
          [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => scheduleTone(note, now + index * 0.055, 0.19, 0.05, "triangle"));
          scheduleNoise(now + 0.12, 0.17, 0.018, 3300);
          break;
        case "strike":
          scheduleTone(164.81, now, 0.29, 0.07, "sawtooth", 73.42);
          scheduleTone(110, now + 0.035, 0.22, 0.035, "square", 82.41);
          scheduleNoise(now, 0.2, 0.07, 700);
          break;
        case "award":
        case "reward":
          [392, 493.88, 587.33, 783.99].forEach((note, index) => scheduleTone(note, now + index * 0.065, 0.23, 0.056, "triangle"));
          break;
        case "win":
          [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => scheduleTone(note, now + index * 0.12, 0.38, 0.07, "sine"));
          scheduleNoise(now + 0.32, 0.25, 0.022, 2500);
          break;
        case "lose":
          scheduleTone(329.63, now, 0.3, 0.06, "triangle", 246.94);
          scheduleTone(246.94, now + 0.2, 0.45, 0.055, "sawtooth", 164.81);
          break;
        case "countdownUrgent":
          scheduleTone(220, now, 0.13, 0.07, "square", 196);
          break;
        case "countdownEnd":
          scheduleTone(196, now, 0.4, 0.065, "sawtooth", 98);
          scheduleNoise(now, 0.12, 0.025, 500);
          break;
        case "countdown":
          scheduleTone(440, now, 0.085, 0.045, "sine", 415.3);
          break;
        case "button":
        case "tap":
        default:
          scheduleTone(330, now, 0.075, 0.042, "triangle", 392);
          break;
      }
    } catch (_) { /* Sound remains optional in restricted browsers. */ }
  }

  function installAudioUnlock() {
    const unlock = () => { if (state.sound) unlockAudio(); };
    document.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    document.addEventListener("keydown", unlock, { capture: true });
    // A tiny click layer gives every control a consistent tactile response;
    // action-specific cues are then mixed on top (reveal, strike, award, etc.).
    document.addEventListener("click", (event) => {
      const button = event.target?.closest?.("button,[role=button],a");
      if (button && !button.disabled && !button.dataset.silent) playTone("button");
    }, { capture: true });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function showFx(kind, caption) {
    const overlay = $("eventOverlay");
    if (!overlay) return;
    const files = {
      reveal: "correct-reveal-burst.png",
      strike: "wrong-strike-stamp.png",
      win: "victory-badge.png",
      lose: "defeat-badge.png",
      streak: "streak-flame.png"
    };
    const file = files[kind];
    if (!file) return;
    clearTimeout(overlayTimer);
    overlay.className = `event-overlay show status-burst ${kind}`;
    overlay.innerHTML = `<div class="fx-stack"><img src="assets/${file}" alt=""><div class="fx-caption">${escapeHtml(caption || "")}</div></div>`;
    const image = overlay.querySelector("img");
    if (image) image.onerror = () => overlay.classList.remove("show");
    overlayTimer = window.setTimeout(() => overlay.classList.remove("show"), kind === "win" || kind === "lose" ? 2200 : 1300);
  }

  function updateCountdown() {
    const box = $("countdownBox");
    const value = $("countdownValue");
    if (!box || !value) return;
    box.classList.toggle("hidden", state.countdown <= 0);
    value.textContent = String(state.countdown);
    box.classList.toggle("urgent", state.countdown > 0 && state.countdown <= 3);
  }

  function hideFx() {
    clearTimeout(overlayTimer);
    $("eventOverlay")?.classList.remove("show");
  }

  function renderBoard() {
    $("questionBoard").textContent = state.question || "Waiting for a question…";
    $("roundNumberBoard").textContent = String(state.round);
    $("roundStatusBoard").textContent = state.status;
    $("teamANameBoard").textContent = state.teamA.name || "Blue Team";
    $("teamAScoreBoard").textContent = String(Number(state.teamA.score) || 0);
    $("teamBNameBoard").textContent = state.teamB.name || "Orange Team";
    $("teamBScoreBoard").textContent = String(Number(state.teamB.score) || 0);
    if ($("teamAAvatarBoard")) $("teamAAvatarBoard").textContent = state.teamA.avatar || "🎃";
    if ($("teamBAvatarBoard")) $("teamBAvatarBoard").textContent = state.teamB.avatar || "👻";
    if ($("setupOverlay")) $("setupOverlay").classList.toggle("hidden", state.setupComplete);
    $("activeTeamBoard").textContent = state.activeTeam === "A" ? (state.teamA.name || "Blue Team") : (state.teamB.name || "Orange Team");
    const total = state.answers.reduce((sum, answer) => sum + (answer.revealed ? Number(answer.points) || 0 : 0), 0);
    $("roundPointsBoard").textContent = String(total);
    const grid = $("answerGrid");
    grid.innerHTML = "";
    state.answers.forEach((answer, index) => {
      const item = document.createElement("div");
      item.className = `answer-card ${answer.revealed ? "revealed reveal" : "hidden-answer"}`;
      item.innerHTML = `<div class="answer-num">${index + 1}</div><div class="answer-text">${escapeHtml(answer.text || "Blank answer")}</div><div class="answer-points">${answer.revealed ? Number(answer.points) || 0 : ""}</div>`;
      if (state.selfRun && !answer.revealed) item.title = "Click to reveal this answer";
      if (state.selfRun) item.addEventListener("click", () => revealAnswer(index));
      grid.appendChild(item);
    });
    document.querySelectorAll(".strike-dot").forEach((dot, index) => dot.classList.toggle("active", index < state.strikes));
    $("soundIcon").textContent = state.sound ? "🔊" : "🔇";
    $("playerControls")?.classList.toggle("hidden", !state.selfRun);
    $("selfRunToggle").textContent = `Self-Run: ${state.selfRun ? "On" : "Off"}`;
    document.body.classList.toggle("self-run", state.selfRun);
    document.body.classList.toggle("streak-on", state.revealStreak >= 3);
    updateCountdown();
  }

  function renderPresetOptions() {
    const select = $("presetSelect");
    if (!select) return;
    const current = select.value;
    select.innerHTML = Object.entries(PRESETS).map(([key, preset]) => `<option value="${key}">${escapeHtml(preset.label)}</option>`).join("");
    if (PRESETS[current]) select.value = current;
  }

  function renderAnswerEditor() {
    const editor = $("answerEditor");
    if (!editor) return;
    editor.innerHTML = "";
    state.answers.forEach((answer, index) => {
      const row = document.createElement("div");
      row.className = "editor-row";
      row.dataset.index = String(index);
      row.innerHTML = `<span class="row-num">${index + 1}</span><input class="answer-text-input" value="${escapeAttribute(answer.text)}" placeholder="Answer ${index + 1}" aria-label="Answer ${index + 1}"><input class="answer-points-input" type="number" min="0" max="100" value="${Number(answer.points) || 0}" aria-label="Score for answer ${index + 1}"><button class="remove-answer" type="button" title="Remove answer">×</button>`;
      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.className = `small-btn reveal-row ${answer.revealed ? "is-revealed" : ""}`;
      reveal.textContent = answer.revealed ? "Revealed" : "Reveal";
      reveal.title = "Toggle answer reveal";
      row.appendChild(reveal);
      editor.appendChild(row);
    });
  }

  function renderRewardQueue() {
    const queue = $("rewardQueue");
    if (!queue) return;
    if (!state.roster.length) {
      queue.innerHTML = '<p class="tip">Add one student per line to create the reward queue.</p>';
      return;
    }
    queue.innerHTML = state.roster.map((student, index) => `<div class="reward-row ${student.rewarded ? "rewarded" : ""}"><span>${escapeHtml(student.name)}</span><button class="tool-btn reward-btn" data-index="${index}">${student.rewarded ? "Awarded" : "Award"}</button></div>`).join("");
  }

  function renderHost() {
    $("questionInput").value = state.question;
    $("roundInput").value = state.round;
    $("activeTeamInput").value = state.activeTeam;
    $("statusInput").value = state.status;
    $("teamANameInput").value = state.teamA.name;
    $("teamAScoreInput").value = state.teamA.score;
    $("teamBNameInput").value = state.teamB.name;
    $("teamBScoreInput").value = state.teamB.score;
    $("awardBtn").disabled = state.roundAwarded;
    $("awardBtn").textContent = state.roundAwarded ? "✓ Round awarded" : "＋ Award round points";
    if ($('rosterInput')) $('rosterInput').value = state.roster.map((student) => student.name).join("\n");
    if ($('rewardNameInput')) $('rewardNameInput').value = state.rewardName;
    renderAnswerEditor();
    renderRewardQueue();
  }

  function renderAll() {
    renderPresetOptions();
    renderBoard();
    renderHost();
    document.body.classList.toggle("no-motion", !state.motion);
    $("motionToggle")?.classList.toggle("is-off", !state.motion);
  }

  function revealAnswer(index) {
    const answer = state.answers[index];
    if (!answer || answer.revealed) return;
    answer.revealed = true;
    state.revealStreak += 1;
    playTone(state.revealStreak >= 3 ? "streak" : "reveal");
    saveState();
    renderAll();
    showFx(state.revealStreak >= 3 ? "streak" : "reveal", state.revealStreak >= 3 ? `Streak ×${state.revealStreak}` : "Correct answer");
    toast(`Revealed: ${answer.text || "Blank answer"}`);
  }

  function revealNext() {
    const index = state.answers.findIndex((answer) => !answer.revealed);
    if (index < 0) return toast("All answers are revealed");
    revealAnswer(index);
  }

  function strike() {
    if (state.strikes >= 3) return toast("This round already has three X marks");
    state.strikes += 1;
    state.revealStreak = 0;
    playTone("strike");
    saveState();
    renderAll();
    showFx("strike", `Wrong ${state.strikes} / 3`);
    toast(`Wrong answer ${state.strikes} / 3`);
  }

  function awardRound() {
    if (state.roundAwarded) return toast("This round has already been awarded");
    const points = state.answers.reduce((sum, answer) => sum + (answer.revealed ? Number(answer.points) || 0 : 0), 0);
    if (!points) return toast("Reveal at least one answer first");
    const team = state.activeTeam === "A" ? state.teamA : state.teamB;
    team.score = Number(team.score) + points;
    state.roundAwarded = true;
    playTone("award");
    saveState();
    renderAll();
    showFx("win", `+${points} points`);
    toast(`${team.name} earned ${points} points`);
  }

  function nextRound() {
    hideFx();
    window.clearInterval(countdownTimer);
    countdownTimer = null;
    state.round += 1;
    state.strikes = 0;
    state.revealStreak = 0;
    state.outcome = "none";
    state.roundAwarded = false;
    state.countdown = 0;
    state.answers.forEach((answer) => { answer.revealed = false; });
    state.status = "Ready";
    saveState();
    renderAll();
    playTone("tap");
    toast(`Round ${state.round} is ready`);
  }

  function newQuestion() {
    hideFx();
    window.clearInterval(countdownTimer);
    countdownTimer = null;
    state.question = "Type a new question";
    state.answers = Array.from({ length: 6 }, () => ({ text: "", points: 0, revealed: false }));
    state.strikes = 0;
    state.revealStreak = 0;
    state.outcome = "none";
    state.roundAwarded = false;
    state.countdown = 0;
    state.status = "Ready";
    saveState();
    renderAll();
    $("questionInput").focus();
    toast("Blank question created");
  }

  function loadPreset() {
    hideFx();
    const key = $("presetSelect")?.value;
    const preset = PRESETS[key];
    if (!preset) return;
    state.question = preset.question;
    state.answers = preset.answers.map(([text, points]) => ({ text, points, revealed: false }));
    state.strikes = 0;
    state.revealStreak = 0;
    state.outcome = "none";
    state.roundAwarded = false;
    state.countdown = 0;
    state.status = "Ready";
    saveState();
    renderAll();
    toast(`${preset.label} loaded`);
  }

  function startCountdown() {
    window.clearInterval(countdownTimer);
    state.countdown = 10;
    state.status = "Buzz-in";
    saveState();
    renderAll();
    toast("Buzz-in countdown started");
    countdownTimer = window.setInterval(() => {
      state.countdown -= 1;
      playTone(state.countdown > 0 && state.countdown <= 3 ? "countdownUrgent" : state.countdown > 0 ? "countdown" : "countdownEnd");
      updateCountdown();
      if (state.countdown <= 0) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
        state.status = "Answering";
        saveState();
        renderAll();
        toast("Time is up");
      }
    }, 1000);
  }

  function endRound() {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
    state.countdown = 0;
    state.status = "Round over";
    state.outcome = Number(state.teamA.score) >= Number(state.teamB.score) ? "win" : "lose";
    saveState();
    renderAll();
    playTone(state.outcome === "win" ? "win" : "lose");
    showFx(state.outcome, state.outcome === "win" ? "Victory" : "Keep going");
    toast("Round settled — rewards are ready");
  }

  function quickNextRound() {
    nextRound();
    toast("Next round started — class list and scores kept");
  }

  function resetGame() {
    hideFx();
    if (!window.confirm("Reset scores, answers, and round number?")) return;
    window.clearInterval(countdownTimer);
    countdownTimer = null;
    state = clone(defaultState);
    saveState();
    renderAll();
    toast("Game reset");
  }

  function updateRosterFromInput() {
    const lines = String($("rosterInput")?.value || "").split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
    const previous = new Map(state.roster.map((student) => [student.name.toLowerCase(), student.rewarded]));
    state.roster = lines.map((name) => ({ name, rewarded: previous.get(name.toLowerCase()) || false }));
    saveState();
    renderRewardQueue();
  }

  function toggleReward(index) {
    if (!state.roster[index]) return;
    state.roster[index].rewarded = !state.roster[index].rewarded;
    if (state.roster[index].rewarded) playTone("reward");
    saveState();
    renderRewardQueue();
    toast(`${state.roster[index].name} ${state.roster[index].rewarded ? "received" : "is back in"} ${state.rewardName}`);
  }

  function markAllRewards() {
    state.roster.forEach((student) => { student.rewarded = true; });
    if (state.roster.length) playTone("award");
    saveState();
    renderRewardQueue();
    toast(state.roster.length ? `Marked ${state.roster.length} students as awarded` : "Add students first");
  }

  function syncField(event) {
    const id = event.target.id;
    const value = event.target.value;
    if (id === "questionInput") state.question = value;
    else if (id === "roundInput") state.round = Math.max(1, Number(value) || 1);
    else if (id === "activeTeamInput") state.activeTeam = value;
    else if (id === "statusInput") state.status = value;
    else if (id === "teamANameInput") state.teamA.name = value;
    else if (id === "teamAScoreInput") state.teamA.score = Math.max(0, Number(value) || 0);
    else if (id === "teamBNameInput") state.teamB.name = value;
    else if (id === "teamBScoreInput") state.teamB.score = Math.max(0, Number(value) || 0);
    else if (id === "rewardNameInput") state.rewardName = value || "Halloween Treat";
    else return;
    saveState();
    renderBoard();
  }

  function openSetup() {
    $("setupTeamAName").value = state.teamA.name;
    $("setupTeamBName").value = state.teamB.name;
    document.querySelectorAll(".avatar-picker").forEach((picker) => {
      const team = picker.dataset.team === "A" ? state.teamA : state.teamB;
      picker.querySelectorAll(".avatar-choice").forEach((button) => button.classList.toggle("selected", button.dataset.avatar === team.avatar));
    });
    $("setupOverlay").classList.remove("hidden");
  }

  function startGame() {
    state.teamA.name = $("setupTeamAName").value.trim() || "Blue Team";
    state.teamB.name = $("setupTeamBName").value.trim() || "Orange Team";
    const selectedA = document.querySelector('.avatar-picker[data-team="A"] .avatar-choice.selected');
    const selectedB = document.querySelector('.avatar-picker[data-team="B"] .avatar-choice.selected');
    state.teamA.avatar = selectedA?.dataset.avatar || state.teamA.avatar || "🎃";
    state.teamB.avatar = selectedB?.dataset.avatar || state.teamB.avatar || "👻";
    state.setupComplete = true;
    saveState();
    renderAll();
    toast("Teams ready — let’s play");
  }

  function switchView() {
    const board = $("boardView");
    const host = $("hostView");
    const openingHost = host.classList.contains("hidden");
    board.classList.toggle("hidden", openingHost);
    host.classList.toggle("hidden", !openingHost);
    $("viewToggle").textContent = openingHost ? "Game Board" : "Host Console";
  }

  function bindEvents() {
    installAudioUnlock();
    $("viewToggle").addEventListener("click", switchView);
    $("teamSetupBtn").addEventListener("click", openSetup);
    $("startGameBtn").addEventListener("click", startGame);
    document.querySelectorAll(".avatar-choice").forEach((button) => button.addEventListener("click", () => {
      button.closest(".avatar-picker").querySelectorAll(".avatar-choice").forEach((choice) => choice.classList.remove("selected"));
      button.classList.add("selected");
    }));
    $("selfRunToggle").addEventListener("click", () => { state.selfRun = !state.selfRun; saveState(); renderAll(); toast(state.selfRun ? "Self-Run Mode is on" : "Self-Run Mode is off"); });
    $("soundToggle").addEventListener("click", () => { state.sound = !state.sound; saveState(); renderAll(); toast(state.sound ? "Sound on" : "Sound off"); });
    $("motionToggle").addEventListener("click", () => { state.motion = !state.motion; saveState(); renderAll(); toast(state.motion ? "Motion on" : "Motion off"); });
    $("fullscreenBtn").addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
    ["questionInput", "roundInput", "activeTeamInput", "statusInput", "teamANameInput", "teamAScoreInput", "teamBNameInput", "teamBScoreInput", "rewardNameInput"].forEach((id) => { const field = $(id); field?.addEventListener("input", syncField); field?.addEventListener("change", syncField); });
    $("revealNextBtn").addEventListener("click", revealNext);
    $("strikeBtn").addEventListener("click", strike);
    $("awardBtn").addEventListener("click", awardRound);
    $("nextRoundBtn").addEventListener("click", nextRound);
    $("newQuestionBtn").addEventListener("click", newQuestion);
    $("countdownBtn").addEventListener("click", startCountdown);
    $("endRoundBtn").addEventListener("click", endRound);
    $("loadPresetBtn").addEventListener("click", loadPreset);
    $("quickNextBtn").addEventListener("click", quickNextRound);
    $("playerRevealBtn").addEventListener("click", revealNext);
    $("playerStrikeBtn").addEventListener("click", strike);
    $("playerCountdownBtn").addEventListener("click", startCountdown);
    $("playerNextBtn").addEventListener("click", nextRound);
    $("switchTeamBtn").addEventListener("click", () => { state.activeTeam = state.activeTeam === "A" ? "B" : "A"; saveState(); renderAll(); toast(`Active team: ${state.activeTeam === "A" ? state.teamA.name : state.teamB.name}`); });
    $("resetStrikesBtn").addEventListener("click", () => { state.strikes = 0; saveState(); renderAll(); toast("Strikes cleared"); });
    $("hideAllBtn").addEventListener("click", () => { state.answers.forEach((answer) => { answer.revealed = false; }); state.revealStreak = 0; saveState(); renderAll(); toast("Answers hidden"); });
    $("resetGameBtn").addEventListener("click", resetGame);
    $("addAnswerBtn").addEventListener("click", () => { if (state.answers.length >= 12) return toast("A maximum of 12 answers is supported"); state.answers.push({ text: "", points: 0, revealed: false }); saveState(); renderAll(); });
    $("answerEditor").addEventListener("input", (event) => { const row = event.target.closest(".editor-row"); if (!row) return; const index = Number(row.dataset.index); if (event.target.classList.contains("answer-text-input")) state.answers[index].text = event.target.value; if (event.target.classList.contains("answer-points-input")) state.answers[index].points = Math.max(0, Number(event.target.value) || 0); saveState(); renderBoard(); });
    $("answerEditor").addEventListener("click", (event) => { const row = event.target.closest(".editor-row"); if (!row) return; const index = Number(row.dataset.index); if (event.target.classList.contains("remove-answer")) { state.answers.splice(index, 1); saveState(); renderAll(); } else if (event.target.classList.contains("reveal-row")) revealAnswer(index); });
    $("rosterInput").addEventListener("input", updateRosterFromInput);
    $("saveRosterBtn").addEventListener("click", () => { updateRosterFromInput(); toast("Class list saved"); });
    $("markAllRewardsBtn").addEventListener("click", markAllRewards);
    $("rewardQueue").addEventListener("click", (event) => { const button = event.target.closest(".reward-btn"); if (button) toggleReward(Number(button.dataset.index)); });
    $("exportBtn").addEventListener("click", () => { const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `family-fuel-round-${state.round}.json`; link.click(); URL.revokeObjectURL(url); toast("Save exported"); });
    $("importBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", async (event) => { const file = event.target.files[0]; if (!file) return; try { window.clearInterval(countdownTimer); countdownTimer = null; state = normalizeState(JSON.parse(await file.text())); saveState(); renderAll(); toast("Save imported"); } catch (_) { toast("Import failed — invalid JSON"); } event.target.value = ""; });
    document.addEventListener("keydown", (event) => { if (event.target.matches("input,textarea,select")) return; const key = event.key.toLowerCase(); if (key === "r") revealNext(); else if (key === "x") strike(); else if (key === "n") nextRound(); else if (event.key === " ") { event.preventDefault(); switchView(); } });
  }

  bindEvents();
  renderAll();
})();


