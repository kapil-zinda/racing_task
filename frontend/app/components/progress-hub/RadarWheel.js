"use client";

import { radarPoints } from "../../lib/vizUtils";

export default function RadarWheel({ mission }) {
  const wheelAxes = mission.axes?.length ? mission.axes : ["No Dimension Yet"];
  const radarValuesCoverage = wheelAxes.map((axis) => mission.axisStats[axis]?.coverage || 0);
  const radarValuesRetention = wheelAxes.map((axis) => mission.axisStats[axis]?.retention || 0);
  const radarValuesPerformance = wheelAxes.map((axis) => mission.axisStats[axis]?.performance || 0);

  return (
    <article className="milestone-panel radar-panel">
      <h2>Growth Wheel</h2>
      <p className="day-state">Coverage + Retention + Performance balance across every focus area.</p>
      <svg viewBox="0 0 340 340" className="radar-svg" role="img" aria-label="Readiness radar">
        <circle cx="170" cy="170" r="120" className="radar-ring" />
        <circle cx="170" cy="170" r="90" className="radar-ring" />
        <circle cx="170" cy="170" r="60" className="radar-ring" />
        <circle cx="170" cy="170" r="30" className="radar-ring" />
        <polygon points={radarPoints(radarValuesCoverage, 120, 170, 170)} className="radar-poly coverage" />
        <polygon points={radarPoints(radarValuesRetention, 120, 170, 170)} className="radar-poly retention" />
        <polygon points={radarPoints(radarValuesPerformance, 120, 170, 170)} className="radar-poly performance" />
      </svg>
      <div className="radar-legend">
        <span><i className="dot radar-dot-coverage" />Coverage</span>
        <span><i className="dot radar-dot-retention" />Retention</span>
        <span><i className="dot radar-dot-performance" />Performance</span>
      </div>
      <div className="axis-mini-grid">
        {wheelAxes.map((axis) => (
          <div key={axis} className="axis-mini-card">
            <strong>{axis}</strong>
            <div className="axis-bars">
              <span style={{ width: `${mission.axisStats[axis]?.coverage || 0}%` }} className="bar coverage" />
              <span style={{ width: `${mission.axisStats[axis]?.retention || 0}%` }} className="bar retention" />
              <span style={{ width: `${mission.axisStats[axis]?.performance || 0}%` }} className="bar performance" />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
