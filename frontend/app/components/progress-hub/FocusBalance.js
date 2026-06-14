"use client";

export default function FocusBalance({ mission }) {
  const axes = Array.isArray(mission?.axes) ? mission.axes : [];

  return (
    <article className="hub-card hub-balance">
      <h3>Balance</h3>
      <p className="day-state">Coverage, retention, and performance across your whole plan.</p>
      <div className="balance-rows">
        <div className="balance-row">
          <span>Coverage</span>
          <div className="balance-track">
            <div className="balance-fill coverage" style={{ width: `${mission?.coverageScore || 0}%` }} />
          </div>
          <strong>{mission?.coverageScore || 0}%</strong>
        </div>
        <div className="balance-row">
          <span>Retention</span>
          <div className="balance-track">
            <div className="balance-fill retention" style={{ width: `${mission?.retentionScore || 0}%` }} />
          </div>
          <strong>{mission?.retentionScore || 0}%</strong>
        </div>
        <div className="balance-row">
          <span>Performance</span>
          <div className="balance-track">
            <div className="balance-fill performance" style={{ width: `${mission?.performanceScore || 0}%` }} />
          </div>
          <strong>{mission?.performanceScore || 0}%</strong>
        </div>
      </div>

      {axes.length ? (
        <div className="balance-axes">
          {axes.map((axis) => (
            <div key={axis} className="balance-axis-row">
              <span className="balance-axis-label">{axis}</span>
              <div className="balance-track small">
                <div className="balance-fill readiness" style={{ width: `${mission.axisStats?.[axis]?.readiness || 0}%` }} />
              </div>
              <strong>{mission.axisStats?.[axis]?.readiness || 0}%</strong>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
