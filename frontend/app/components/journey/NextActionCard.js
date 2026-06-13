"use client";

export default function NextActionCard({ mission, battleDone, onToggle, battleProgress }) {
  const tasks = Array.isArray(mission?.battleTasks) ? mission.battleTasks : [];

  return (
    <section className="milestone-panel battle-panel next-action-panel">
      <div className="next-action-head">
        <h2>▶ Next Actions</h2>
        <span className="status-chip status-active">Today</span>
      </div>
      <p className="next-action-sub">The highest-leverage things to do right now.</p>
      <div className="battle-list">
        {tasks.length === 0 ? (
          <p className="day-state">No active tasks yet — add areas to your journey to get suggestions.</p>
        ) : (
          tasks.map((task, idx) => (
            <button
              key={`${task.type}-${idx}`}
              className={`battle-task ${battleDone[idx] ? "done" : ""}`}
              onClick={() => onToggle(idx)}
            >
              <span className="battle-type">{task.type}</span>
              <span>{task.text}</span>
            </button>
          ))
        )}
      </div>
      {tasks.length ? (
        <>
          <div className="battle-progress">
            <div className="battle-progress-fill" style={{ width: `${battleProgress}%` }} />
          </div>
          <p className="day-state">Today&apos;s progress: {battleProgress}%</p>
        </>
      ) : null}
    </section>
  );
}
