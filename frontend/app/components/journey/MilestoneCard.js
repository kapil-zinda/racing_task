"use client";

import { dimensionCompletion } from "../../lib/missionModel";

const KIND_LABELS = {
  course: "Course",
  book: "Book",
  random: "Random Topic",
  test: "Test Set",
};

const KIND_ICON = {
  course: "📚",
  book: "📘",
  random: "✍️",
  test: "📝",
};

function pct(done, total) {
  if (!total) return 0;
  return Math.round((Math.max(0, done) / total) * 100);
}

export default function MilestoneCard({ dim, onClick }) {
  const coverage = pct(dim.coverageDone, dim.coverageTotal);
  const retention = pct(dim.retentionDone, dim.retentionTotal);
  const performance = pct(dim.performanceDone, dim.performanceTotal);
  const overall = dimensionCompletion(dim);

  return (
    <button type="button" className="milestone-item milestone-card" onClick={onClick}>
      <div className="milestone-card-head">
        <div>
          <span className={`progress-card-kind kind-${dim.kind}`}>
            {KIND_ICON[dim.kind] || "🎯"} {KIND_LABELS[dim.kind] || dim.kind}
          </span>
          <h3>{dim.label}</h3>
        </div>
        <strong>{overall}%</strong>
      </div>
      <div className="milestone-card-bars">
        <div className="milestone-card-row">
          <span>Coverage</span>
          <div className="progress-track">
            <div className="progress-fill coverage" style={{ width: `${coverage}%` }} />
          </div>
          <strong>{coverage}%</strong>
        </div>
        <div className="milestone-card-row">
          <span>Retention</span>
          <div className="progress-track">
            <div className="progress-fill retention" style={{ width: `${retention}%` }} />
          </div>
          <strong>{retention}%</strong>
        </div>
        <div className="milestone-card-row">
          <span>Performance</span>
          <div className="progress-track">
            <div className="progress-fill performance" style={{ width: `${performance}%` }} />
          </div>
          <strong>{performance}%</strong>
        </div>
      </div>
    </button>
  );
}
