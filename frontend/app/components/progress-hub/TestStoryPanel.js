"use client";

export default function TestStoryPanel({ mission }) {
  return (
    <article className="milestone-panel">
      <h2>Test Performance Story</h2>
      <p className="day-state">Effort-output relationship, not marks only.</p>
      <div className="story-grid">
        <div className="story-kpi"><span>Tests attempted</span><strong>{mission.testsAttempted}</strong></div>
        <div className="story-kpi"><span>Review completion</span><strong>{mission.reviewRate}%</strong></div>
        <div className="story-kpi"><span>Performance index</span><strong>{mission.performanceScore}</strong></div>
        <div className="story-kpi"><span>Tests safety</span><strong>{mission.csatSafety}</strong></div>
      </div>
      <div className="river-chart">
        <div className="river-flow green" style={{ width: `${Math.max(8, mission.performanceScore)}%` }} />
        <div className="river-flow red" style={{ width: `${Math.max(5, 100 - mission.reviewRate)}%` }} />
        <div className="river-stones" style={{ width: `${Math.max(5, mission.revisionDebt)}%` }} />
      </div>
      <div className="river-labels">
        <span>Green: growth</span>
        <span>Red: careless/missed review</span>
        <span>Dark: repeated weak zones</span>
      </div>
    </article>
  );
}
