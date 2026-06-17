"use client";

import RadialRing from "../shared/RadialRing";

function healthColor(value) {
  if (value >= 65) return "#7CF29C";
  if (value >= 40) return "#FFD166";
  return "#FF6B6B";
}

export default function GoalHealthHero({ mission, streaks, weekPulse }) {
  const readiness = Math.max(0, Math.min(100, mission?.readiness || 0));
  const delta = weekPulse?.deltaPct ?? 0;
  const trendArrow = delta > 0 ? "↗" : delta < 0 ? "↘" : "→";
  const trendCls = delta > 0 ? "up" : delta < 0 ? "down" : "flat";

  return (
    <article className="hub-card hub-goal-health">
      <RadialRing value={readiness} size={108} stroke={10} color={healthColor(readiness)} label={`${readiness}`} sublabel="Goal Health" />
      <div className="hub-goal-health-meta">
        <span className={`hub-trend hub-trend-${trendCls}`}>
          {trendArrow} {Math.abs(delta)}% vs last week
        </span>
        <span className="hub-streak">
          🔥 {streaks?.current || 0}-day streak <small>best {streaks?.longest || 0}</small>
        </span>
        <span className={`hub-risk risk-${mission?.risk?.cls || "low"}`}>Risk: {mission?.risk?.label || "Low"}</span>
      </div>
    </article>
  );
}
