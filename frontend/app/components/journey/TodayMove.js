"use client";

export default function TodayMove({ mission, battleDone, onToggle }) {
  const tasks = Array.isArray(mission?.battleTasks) ? mission.battleTasks : [];
  if (!tasks.length) return null;

  const [primary, ...rest] = tasks;
  const primaryDone = Boolean(battleDone?.[0]);

  return (
    <section className="today-move">
      <p className="today-move-label">
        <span className="today-move-bolt" aria-hidden="true">⚡</span> Today&apos;s Move
      </p>
      <div className={`today-move-card ${primaryDone ? "done" : ""}`}>
        <span className="today-move-type">{primary.type}</span>
        <p className="today-move-text">{primary.text}</p>
        <button type="button" className="today-move-cta" onClick={() => onToggle?.(0)}>
          {primaryDone ? "Done ✓" : "Do it →"}
        </button>
      </div>
      {rest.length ? (
        <div className="today-move-extra">
          <span className="today-move-extra-label">Also worth doing</span>
          <div className="today-move-chips">
            {rest.map((task, idx) => {
              const realIdx = idx + 1;
              const done = Boolean(battleDone?.[realIdx]);
              return (
                <button
                  key={`${task.type}-${realIdx}`}
                  type="button"
                  className={`today-move-chip ${done ? "done" : ""}`}
                  onClick={() => onToggle?.(realIdx)}
                >
                  {done ? "✓" : "○"} {task.text}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
