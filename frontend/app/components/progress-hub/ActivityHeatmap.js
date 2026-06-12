"use client";

import { heatLevel } from "../../lib/vizUtils";

const KIND_LABELS = {
  study: "Study",
  revision: "Revision",
  practice: "Practice",
};

export default function ActivityHeatmap({ activityByDate, dates }) {
  return (
    <article className="milestone-panel">
      <h2>Consistency Heatmap</h2>
      <p className="day-state">Study vs Revision vs Practice activity over the last {dates.length} days.</p>
      <div className="heatmap-group">
        {Object.keys(KIND_LABELS).map((kind) => (
          <div key={kind} className="heatmap-row">
            <strong>{KIND_LABELS[kind]}</strong>
            <div className="heatmap-grid">
              {dates.map((date) => {
                const v = (activityByDate[date] || {})[kind] || 0;
                return <span key={`${kind}-${date}`} className={`heat-cell level-${heatLevel(v)}`} title={`${date}: ${v}`} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
