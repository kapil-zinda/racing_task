"use client";

export default function NeedsAttention({ mission }) {
  const leaks = Array.isArray(mission?.leaks) ? mission.leaks : [];

  return (
    <article className="hub-card hub-attention">
      <h3>⚠ Needs Attention</h3>
      {leaks.length === 0 ? (
        <p className="day-state">Nothing slipping right now — keep the rhythm going.</p>
      ) : (
        <div className="attention-list">
          {leaks.map((leak, idx) => (
            <div key={`${leak.title}-${idx}`} className={`attention-row attention-${leak.severity}`}>
              <strong>{leak.title}</strong>
              <span>{leak.detail}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
