"use client";

export default function NeedsAttention({ attentionNodes = [] }) {
  return (
    <article className="hub-card hub-attention">
      <h3>⚠ Needs Attention</h3>
      {attentionNodes.length === 0 ? (
        <p className="day-state">Nothing slipping right now — keep the rhythm going.</p>
      ) : (
        <div className="attention-list">
          {attentionNodes.map((node, idx) => (
            <div
              key={`${node.journeyName}-${node.label}-${idx}`}
              className={`attention-row attention-${node.neverStarted ? "medium" : node.daysSince > 7 ? "high" : "medium"}`}
            >
              <strong>{node.label}</strong>
              {node.neverStarted
                ? <span>{node.journeyName} — not started yet</span>
                : <span>{node.journeyName} — not touched for {node.daysSince} day{node.daysSince !== 1 ? "s" : ""}</span>
              }
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
