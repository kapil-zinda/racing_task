"use client";

import { useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

const MILESTONES = [
  { points: 20, reward: "Coffee Treat" },
  { points: 40, reward: "Movie Night" },
  { points: 70, reward: "Dinner Out" },
  { points: 100, reward: "Weekend Mini Trip" }
];

const POINTS_MAP = {
  new_class: 3,
  revision: 2,
  ticket_resolved: 4,
  test_completed: 4
};

const ACTION_LABELS = {
  new_class: "New Class",
  revision: "Revision",
  ticket_resolved: "Ticket Resolved",
  test_completed: "Test Completed"
};

const DIVYA_TEST_OPTIONS = [
  "SFG Level 1",
  "SFG Level 2",
  "PMP Test",
  "CAVA Test"
];

const INITIAL_PLAYERS = [
  { key: "kapil", name: "Kapil", points: 0, reached: [], history: [] },
  { key: "divya", name: "Divya", points: 0, reached: [], history: [] }
];

function nextMilestone(points) {
  return MILESTONES.find((m) => m.points > points) || MILESTONES[MILESTONES.length - 1];
}

function rewardsFromReached(reached) {
  return reached
    .map((mark) => MILESTONES.find((m) => m.points === mark))
    .filter(Boolean);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function racePercent(points) {
  return Math.min(Math.max((points / 100) * 100, 0), 100);
}

export default function HomePage() {
  const [players, setPlayers] = useState(INITIAL_PLAYERS);
  const [toast, setToast] = useState("");
  const [apiError, setApiError] = useState("");
  const [taskModal, setTaskModal] = useState({ open: false, playerId: "", actionType: "" });
  const [taskComment, setTaskComment] = useState("");
  const [selectedTest, setSelectedTest] = useState("");
  const [historyOpen, setHistoryOpen] = useState({ kapil: false, divya: false });
  const [todayDate, setTodayDate] = useState("");
  const [availableDates, setAvailableDates] = useState([]);
  const [winnerCounts, setWinnerCounts] = useState({ kapil: 0, divya: 0, tie: 0 });
  const [isEditable, setIsEditable] = useState(true);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyDate, setHistoryDate] = useState("");
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    const init = async () => {
      if (API_BASE_URL) {
        try {
          const daysRes = await fetch(`${API_BASE_URL}/days`);
          if (!daysRes.ok) {
            const txt = await daysRes.text();
            throw new Error(`Days API failed: ${daysRes.status} ${txt}`);
          }
          const daysData = await daysRes.json();
          const initialToday = daysData.today || "";
          const dates = daysData.dates || [];
          const preferredHistoryDate = dates.find((d) => d !== initialToday) || dates[0] || initialToday;

          setTodayDate(initialToday);
          setHistoryDate(preferredHistoryDate);
          setAvailableDates(dates);
          setWinnerCounts(daysData.winner_counts || { kapil: 0, divya: 0, tie: 0 });

          const res = await fetch(`${API_BASE_URL}/state?date=${encodeURIComponent(initialToday)}`);
          if (!res.ok) {
            const txt = await res.text();
            throw new Error(`State API failed: ${res.status} ${txt}`);
          }
          const data = await res.json();
          setPlayers((prev) =>
            prev.map((p) => ({
              ...p,
              points: data.points?.[p.key] || 0,
              reached: data.reached?.[p.key] || [],
              history: data.history?.[p.key] || []
            }))
          );
          setTodayDate(data.today || initialToday);
          setIsEditable(Boolean(data.editable));
          setWinnerCounts(data.winner_counts || daysData.winner_counts || { kapil: 0, divya: 0, tie: 0 });
          setApiError("");
          return;
        } catch (err) {
          setApiError(String(err.message || err));
          return;
        }
      }

      const saved = localStorage.getItem("race-state");
      if (saved) {
        const parsed = JSON.parse(saved);
        setPlayers((prev) =>
          prev.map((p) => ({
            ...p,
            points: parsed[p.key]?.points || 0,
            reached: parsed[p.key]?.reached || [],
            history: parsed[p.key]?.history || []
          }))
        );
      }
    };

    init();
  }, []);

  useEffect(() => {
    if (API_BASE_URL) return;
    const snapshot = players.reduce((acc, p) => {
      acc[p.key] = { points: p.points, reached: p.reached, history: p.history };
      return acc;
    }, {});
    localStorage.setItem("race-state", JSON.stringify(snapshot));
  }, [players]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  const addPoints = async (playerId, actionType, providedDetail = "", providedTestType = "") => {
    const add = POINTS_MAP[actionType] || 0;
    const detail = providedDetail.trim();
    const testType = providedTestType.trim();
    if (!isEditable) {
      setApiError("Only today's race can be edited.");
      return false;
    }

    if (API_BASE_URL) {
      try {
        const res = await fetch(`${API_BASE_URL}/points`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player_id: playerId, action_type: actionType, test_type: testType, detail })
        });

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Points API failed: ${res.status} ${txt}`);
        }

        const data = await res.json();
        const currentPlayer = players.find((p) => p.key === playerId);
        const beforeReached = currentPlayer?.reached || [];
        const afterReached = data.reached?.[playerId] || [];
        const unlocked = afterReached.find((mark) => !beforeReached.includes(mark));

        if (unlocked) {
          const reward = MILESTONES.find((m) => m.points === unlocked)?.reward || "Reward";
          setToast(`${currentPlayer?.name || playerId} unlocked ${reward} at ${unlocked} points!`);
        }

        setPlayers((prev) =>
          prev.map((p) => ({
            ...p,
            points: data.points?.[p.key] || 0,
            reached: data.reached?.[p.key] || [],
            history: data.history?.[p.key] || []
          }))
        );
        setWinnerCounts(data.winner_counts || winnerCounts);
        setIsEditable(Boolean(data.editable));
        setApiError("");
        return true;
      } catch (err) {
        setApiError(String(err.message || err));
        return false;
      }
    }

    setPlayers((prev) =>
      prev.map((p) => {
        if (p.key !== playerId) return p;

        const updatedPoints = p.points + add;
        const updatedReached = [...p.reached];
        const updatedHistory = [...p.history];

        MILESTONES.forEach((m) => {
          if (updatedPoints >= m.points && !updatedReached.includes(m.points)) {
            updatedReached.push(m.points);
            setToast(`${p.name} unlocked ${m.reward} at ${m.points} points!`);
          }
        });

        updatedHistory.unshift({
          action_type: actionType,
          action_label: actionType === "test_completed" && testType ? testType : ACTION_LABELS[actionType],
          detail: detail || (actionType === "test_completed" && testType ? testType : ACTION_LABELS[actionType]),
          points: add,
          created_at: new Date().toISOString()
        });

        return { ...p, points: updatedPoints, reached: updatedReached, history: updatedHistory };
      })
    );
    return true;
  };

  const openTaskModal = (playerId, actionType) => {
    if (!isEditable) return;
    setTaskModal({ open: true, playerId, actionType });
    setTaskComment("");
    setSelectedTest("");
  };

  const closeTaskModal = () => {
    setTaskModal({ open: false, playerId: "", actionType: "" });
    setTaskComment("");
    setSelectedTest("");
  };

  const submitTaskModal = async () => {
    const isTestAction = taskModal.actionType === "test_completed";
    const testType = isTestAction ? selectedTest.trim() : "";
    const detail = taskComment.trim();
    if (isTestAction && (!testType || !detail)) return;
    if (!isTestAction && !detail) return;
    const ok = await addPoints(taskModal.playerId, taskModal.actionType, detail, testType);
    if (ok) closeTaskModal();
  };

  const openHistoryModal = () => {
    setHistoryModalOpen(true);
    setHistoryData(null);
    setHistoryError("");
    if (!historyDate) {
      const fallback = availableDates.find((d) => d !== todayDate) || availableDates[0] || todayDate;
      setHistoryDate(fallback);
    }
  };

  const closeHistoryModal = () => {
    setHistoryModalOpen(false);
    setHistoryError("");
  };

  const fetchDayHistory = async () => {
    if (!API_BASE_URL || !historyDate) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await fetch(`${API_BASE_URL}/state?date=${encodeURIComponent(historyDate)}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`State API failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setHistoryData({
        date: data.date || historyDate,
        points: data.points || {},
        reached: data.reached || {},
        history: data.history || {}
      });
    } catch (err) {
      setHistoryError(String(err.message || err));
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero">
        {API_BASE_URL ? (
          <div className="top-right-tools">
            <div className="winner-counter compact">
              <span>Kapil Wins: {winnerCounts.kapil || 0}</span>
              <span>Divya Wins: {winnerCounts.divya || 0}</span>
              <span>Ties: {winnerCounts.tie || 0}</span>
            </div>
            <button className="btn-day" onClick={openHistoryModal} disabled={availableDates.length === 0}>
              View Previous Day
            </button>
          </div>
        ) : null}
        <p className="badge">Milestone Reward Challenge</p>
        <div className="race-board">
          {players.map((player) => {
            const percent = racePercent(player.points);
            return (
              <div key={`race-${player.key}`} className="race-lane">
                <div className="race-lane-top">
                  <strong>{player.name}</strong>
                  <span>{Math.min(player.points, 100)} / 100</span>
                </div>
                <div className="race-track">
                  <div className="track-line" />
                  <div className="track-fill" style={{ width: `${percent}%` }} />
                  <div className="race-horse" style={{ left: `calc(${percent}% - 16px)` }}>
                    <span className="horse-emoji" aria-hidden="true">
                      {player.key === "divya" ? "🏃‍♀️" : "🏃‍♂️"}
                    </span>
                  </div>
                  <div className="finish-flag">🏁</div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="subtext">
          New class + revised class + resolved tickets = points. Keep racing and unlock rewards at each milestone.
        </p>
        <div className="legend">
          <span><i className="dot dot-gold" />New Class: +3</span>
          <span><i className="dot dot-blue" />Revision: +2</span>
          <span><i className="dot dot-red" />Ticket Resolved: +4</span>
        </div>
        {API_BASE_URL ? (
          <p className={`api-state ${apiError ? "error" : "ok"}`}>
            {apiError ? `API issue: ${apiError}` : "Connected to backend API"}
          </p>
        ) : (
          <p className="api-state warn">Running in local mode (no backend URL configured).</p>
        )}
      </header>

      <section className="scoreboard">
        {players.map((player) => {
          const next = nextMilestone(player.points);
          const progress = Math.min((player.points / next.points) * 100, 100);
          const earnedRewards = rewardsFromReached(player.reached);

          return (
            <article className="player-card" key={player.key}>
              <div className="player-row">
                <h2 className="player-name">{player.name}</h2>
                <div className="player-points">{player.points}</div>
              </div>

              <div className="progress-wrap">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="progress-label">Next reward at {next.points} points</div>
              </div>

              <div className="action-grid">
                <button className="btn-new" disabled={!isEditable} onClick={() => openTaskModal(player.key, "new_class")}>+ New Class</button>
                <button className="btn-revise" disabled={!isEditable} onClick={() => openTaskModal(player.key, "revision")}>+ Revision</button>
                {player.key === "divya" ? (
                  <button className="btn-ticket" disabled={!isEditable} onClick={() => openTaskModal(player.key, "test_completed")}>+ Tests</button>
                ) : (
                  <button className="btn-ticket" disabled={!isEditable} onClick={() => openTaskModal(player.key, "ticket_resolved")}>+ Ticket</button>
                )}
              </div>

              <div className="earned-wrap">
                <h3>{player.name} Rewards</h3>
                <div className="earned-list">
                  {earnedRewards.length === 0 ? (
                    <span className="earned-empty">No rewards yet</span>
                  ) : (
                    earnedRewards.map((r) => (
                      <span key={`${player.key}-${r.points}`} className="earned-chip">
                        {r.reward} ({r.points})
                      </span>
                    ))
                  )}
                </div>
              </div>

              <button
                className="history-toggle"
                onClick={() => setHistoryOpen((prev) => ({ ...prev, [player.key]: !prev[player.key] }))}
              >
                {historyOpen[player.key] ? "Hide History" : "View History"}
              </button>

              {historyOpen[player.key] ? (
                <div className="history-wrap">
                  <h3>{player.name} Activity History</h3>
                  <div className="history-list">
                    {player.history.length === 0 ? (
                      <span className="history-empty">No activity logged yet</span>
                    ) : (
                      player.history.slice(0, 8).map((item, idx) => (
                        <div key={`${player.key}-${item.created_at}-${idx}`} className="history-item">
                          <div className="history-top">
                            <span className="history-action">{item.action_label || ACTION_LABELS[item.action_type] || "Task"}</span>
                            <span className="history-points">+{item.points}</span>
                          </div>
                          <div className="history-detail">{item.detail}</div>
                          <div className="history-time">{formatTime(item.created_at)}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      <section className="milestone-panel">
        <h2>Milestones & Rewards</h2>
        <div className="milestone-list">
          {MILESTONES.map((m) => (
            <article key={m.points} className="milestone-item">
              <h3>{m.points} pts</h3>
              <p>Reward: {m.reward}</p>
              <div className="milestone-owners">
                {players.map((p) => (
                  <span key={`${m.points}-${p.key}`} className={p.reached.includes(m.points) ? "owner won" : "owner"}>
                    {p.name}: {p.reached.includes(m.points) ? "Unlocked" : "Pending"}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {toast ? <div className="reward-toast">{toast}</div> : null}
      {taskModal.open ? (
        <div className="task-modal-overlay" role="dialog" aria-modal="true">
          <div className="task-modal">
            <h3>Add Activity</h3>
            <p>
              {players.find((p) => p.key === taskModal.playerId)?.name} -{" "}
              {ACTION_LABELS[taskModal.actionType] || "Task"}
            </p>
            {taskModal.actionType === "test_completed" ? (
              <>
                <select
                  className="task-select"
                  value={selectedTest}
                  onChange={(e) => setSelectedTest(e.target.value)}
                >
                  <option value="">Select Test</option>
                  {DIVYA_TEST_OPTIONS.map((test) => (
                    <option key={test} value={test}>
                      {test}
                    </option>
                  ))}
                </select>
                <textarea
                  className="task-textarea"
                  placeholder="Add detail about this test..."
                  value={taskComment}
                  onChange={(e) => setTaskComment(e.target.value)}
                />
              </>
            ) : (
              <textarea
                className="task-textarea"
                placeholder="Write what was completed..."
                value={taskComment}
                onChange={(e) => setTaskComment(e.target.value)}
              />
            )}
            <div className="task-modal-actions">
              <button className="btn-cancel" onClick={closeTaskModal}>Cancel</button>
              <button
                className="btn-save"
                onClick={submitTaskModal}
                disabled={taskModal.actionType === "test_completed" ? (!selectedTest.trim() || !taskComment.trim()) : !taskComment.trim()}
              >
                Save Task
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {historyModalOpen ? (
        <div className="task-modal-overlay" role="dialog" aria-modal="true">
          <div className="task-modal">
            <h3>Previous Day Result</h3>
            <p>Select a date and load race summary in this popup.</p>
            <div className="day-picker-row">
              <select
                className="day-picker"
                value={historyDate}
                onChange={(e) => setHistoryDate(e.target.value)}
              >
                {availableDates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <button className="btn-day" onClick={fetchDayHistory} disabled={!historyDate || historyLoading}>
                Load Result
              </button>
            </div>
            {historyError ? <p className="api-state error">{historyError}</p> : null}
            {historyLoading ? <p className="day-state">Loading...</p> : null}
            {historyData ? (
              <div className="popup-result">
                <p className="day-state">Date: {historyData.date}</p>
                <div className="popup-score-row">
                  <div className="popup-score-card">Kapil: {historyData.points?.kapil || 0}</div>
                  <div className="popup-score-card">Divya: {historyData.points?.divya || 0}</div>
                </div>
                <div className="popup-history-grid">
                  {["kapil", "divya"].map((key) => (
                    <div key={key} className="popup-history-card">
                      <h4>{key === "kapil" ? "Kapil" : "Divya"} History</h4>
                      <div className="history-list">
                        {(historyData.history?.[key] || []).length === 0 ? (
                          <span className="history-empty">No activity logged</span>
                        ) : (
                          (historyData.history?.[key] || []).slice(0, 8).map((item, idx) => (
                            <div key={`${key}-${item.created_at}-${idx}`} className="history-item">
                              <div className="history-top">
                                <span className="history-action">{item.action_label || "Task"}</span>
                                <span className="history-points">+{item.points}</span>
                              </div>
                              <div className="history-detail">{item.detail}</div>
                              <div className="history-time">{formatTime(item.created_at)}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="task-modal-actions">
              <button className="btn-cancel" onClick={closeHistoryModal}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
