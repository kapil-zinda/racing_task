"use client";

export default function DecayPanel({ mission }) {
  return (
    <>
      <article className="milestone-panel leak-panel">
        <h2>Danger Zone</h2>
        <p className="day-state">What is slipping out of control right now?</p>
        <div className="leak-list">
          {mission.leaks.length === 0 ? (
            <p className="day-state">No major leaks detected. Keep consistency alive.</p>
          ) : (
            mission.leaks.map((leak, idx) => (
              <div key={`${leak.title}-${idx}`} className={`leak-card ${leak.severity}`}>
                <h4>{leak.title}</h4>
                <p>{leak.detail}</p>
              </div>
            ))
          )}
        </div>
      </article>

      <article className="milestone-panel">
        <h2>Revision Decay Timeline</h2>
        <p className="day-state">Green recent, yellow due, red fading, grey untouched.</p>
        <div className="decay-strip">
          {mission.timeline.map((item) => (
            <div key={item.key} className={`decay-block ${item.zone}`} title={`${item.label} • ${item.days} days`} />
          ))}
        </div>
      </article>
    </>
  );
}
