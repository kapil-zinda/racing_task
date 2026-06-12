"use client";

export default function SummitSummary({ mission, goalLabel }) {
  return (
    <article className="milestone-panel summit-panel">
      <div className="summit-header">
        <div>
          <h2>Readiness Snapshot</h2>
          <p className="day-state">Am I moving closer to {goalLabel || "my goal"}?</p>
        </div>
        <div className="trajectory-chip">{mission.trajectory}</div>
      </div>
      <div className="summit-metrics">
        <div><span>Readiness</span><strong>{mission.readiness} / 100</strong></div>
        <div><span>Momentum</span><strong className={`momentum-${mission.momentum.cls}`}>{mission.momentum.label}</strong></div>
        <div><span>Risk</span><strong className={`risk-${mission.risk.cls}`}>{mission.risk.label}</strong></div>
      </div>
      <div className="summit-path-wrap">
        <div className="summit-path">
          <div className="summit-fill" style={{ width: `${mission.readiness}%` }} />
          <div className={`summit-fog fog-${mission.risk.cls}`} />
          <div className="summit-marker" style={{ left: `${Math.max(4, mission.readiness)}%` }} />
          <div className="summit-goal">{goalLabel || "Goal"}</div>
        </div>
        <p className="risk-summary">Risk insight: {mission.riskText}</p>
      </div>
    </article>
  );
}
