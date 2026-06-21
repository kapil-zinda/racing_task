"use client";

import { buildTrailNodes } from "../../lib/journeyInsights";

const KIND_ICON = {
  course: "📚",
  book: "📘",
  random: "✍️",
  test: "📝",
};

export default function JourneyTrail({ dimensions, onSelectMilestone }) {
  const nodes = buildTrailNodes(dimensions);
  if (!nodes.length) return null;

  return (
    <section className="journey-trail-card">
      <h2 className="journey-trail-title">The Trail</h2>
      <p className="day-state">Tap a stop to see what&apos;s inside.</p>
      <div className="journey-trail">
        <div className="trail-line" aria-hidden="true" />
        <div className="trail-endpoint trail-start" aria-hidden="true">
          <span className="trail-endpoint-icon">▶</span>
          <span className="trail-endpoint-label">Start</span>
        </div>
        {nodes.map((node, idx) => (
          <button
            key={node.key}
            type="button"
            className={`trail-node trail-${node.state} ${idx % 2 === 1 ? "trail-offset" : ""}`}
            onClick={() => onSelectMilestone?.(node)}
            aria-label={`${node.label}, ${node.completion}% complete${node.isCurrent ? ", you are here" : ""}${node.decaying ? ", needs revision" : ""}`}
          >
            {node.isCurrent ? <span className="trail-here-pin">📍 You are here</span> : null}
            {node.decaying ? <span className="trail-decay-pin" title="Needs revision">⚠</span> : null}
            <span className="trail-node-dot">
              {node.state === "done" ? "✓" : KIND_ICON[node.kind] || "🎯"}
            </span>
            <span className="trail-node-label">{node.label}</span>
            <span className="trail-node-pct">{node.completion}%</span>
          </button>
        ))}
        <div className="trail-endpoint trail-goal" aria-hidden="true">
          <span className="trail-endpoint-icon">🏁</span>
          <span className="trail-endpoint-label">Goal</span>
        </div>
      </div>
    </section>
  );
}
