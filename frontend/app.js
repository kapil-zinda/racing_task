const API_BASE_URL = ""; // Add API Gateway URL, e.g. https://xxxx.execute-api.ap-south-1.amazonaws.com/prod

const milestones = [
  { points: 20, reward: "Coffee Treat" },
  { points: 40, reward: "Movie Night" },
  { points: 70, reward: "Dinner Out" },
  { points: 100, reward: "Weekend Mini Trip" }
];

const players = [
  { key: "kapil", name: "Kapil", points: 0, reached: [] },
  { key: "divya", name: "Divya", points: 0, reached: [] }
];

const scoreboard = document.getElementById("scoreboard");
const milestoneList = document.getElementById("milestoneList");
const rewardToast = document.getElementById("rewardToast");

function localStateFallback() {
  const saved = localStorage.getItem("race-state");
  if (saved) {
    const parsed = JSON.parse(saved);
    players.forEach((p) => {
      p.points = parsed[p.key]?.points || 0;
      p.reached = parsed[p.key]?.reached || [];
    });
  }
}

function persistLocal() {
  const state = {};
  players.forEach((p) => {
    state[p.key] = { points: p.points, reached: p.reached };
  });
  localStorage.setItem("race-state", JSON.stringify(state));
}

function renderMilestones() {
  milestoneList.innerHTML = milestones
    .map(
      (m, idx) => `
      <article class="milestone-item" id="mile-${idx}">
        <h3>${m.points} pts</h3>
        <p>Reward: ${m.reward}</p>
      </article>`
    )
    .join("");
}

function showToast(message) {
  rewardToast.textContent = message;
  rewardToast.classList.remove("hidden");
  setTimeout(() => rewardToast.classList.add("hidden"), 2400);
}

function highlightMilestones() {
  const maxScore = Math.max(...players.map((p) => p.points));
  milestones.forEach((m, idx) => {
    const el = document.getElementById(`mile-${idx}`);
    if (!el) return;
    if (maxScore >= m.points) {
      el.classList.add("active");
    } else {
      el.classList.remove("active");
    }
  });
}

function createCard(player) {
  const nextMilestone = milestones.find((m) => m.points > player.points) || milestones[milestones.length - 1];
  const progress = Math.min((player.points / nextMilestone.points) * 100, 100);

  return `
    <article class="player-card">
      <div class="player-row">
        <h2 class="player-name">${player.name}</h2>
        <div class="player-points">${player.points}</div>
      </div>

      <div class="progress-wrap">
        <div class="progress-track">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="progress-label">Next reward at ${nextMilestone.points} points</div>
      </div>

      <div class="action-grid">
        <button class="btn-new" onclick="addPoints('${player.key}', 'new_class')">+ New Class</button>
        <button class="btn-revise" onclick="addPoints('${player.key}', 'revision')">+ Revision</button>
        <button class="btn-ticket" onclick="addPoints('${player.key}', 'ticket_resolved')">+ Ticket</button>
      </div>
    </article>
  `;
}

function render() {
  scoreboard.innerHTML = players.map(createCard).join("");
  highlightMilestones();
}

function calculatePoints(actionType) {
  const map = {
    new_class: 3,
    revision: 2,
    ticket_resolved: 4
  };
  return map[actionType] || 0;
}

function evaluateRewards(player) {
  milestones.forEach((m) => {
    if (player.points >= m.points && !player.reached.includes(m.points)) {
      player.reached.push(m.points);
      showToast(`${player.name} unlocked: ${m.reward} at ${m.points} points!`);
    }
  });
}

async function addPoints(playerId, actionType) {
  const player = players.find((p) => p.key === playerId);
  if (!player) return;

  const pointsToAdd = calculatePoints(actionType);

  if (API_BASE_URL) {
    try {
      const res = await fetch(`${API_BASE_URL}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: playerId, action_type: actionType })
      });
      if (!res.ok) throw new Error("API failed");
      const data = await res.json();
      player.points = data.points[playerId];
      player.reached = data.reached[playerId] || [];
    } catch (error) {
      player.points += pointsToAdd;
    }
  } else {
    player.points += pointsToAdd;
  }

  evaluateRewards(player);
  persistLocal();
  render();
}

window.addPoints = addPoints;

async function init() {
  renderMilestones();

  if (API_BASE_URL) {
    try {
      const res = await fetch(`${API_BASE_URL}/state`);
      if (!res.ok) throw new Error("State API failed");
      const data = await res.json();
      players.forEach((p) => {
        p.points = data.points[p.key] || 0;
        p.reached = data.reached[p.key] || [];
      });
      render();
      return;
    } catch (error) {
      localStateFallback();
      render();
      return;
    }
  }

  localStateFallback();
  render();
}

init();
