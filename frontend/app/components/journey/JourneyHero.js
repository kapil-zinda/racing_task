"use client";

import RadialRing from "../shared/RadialRing";
import { daysUntil } from "../../lib/dateUtils";

function healthColor(value) {
  if (value >= 65) return "#7CF29C";
  if (value >= 40) return "#FFD166";
  return "#FF6B6B";
}

export default function JourneyHero({ missionConfig, mission, streaks }) {
  const title = missionConfig?.title || "Your Journey";
  const icon = missionConfig?.icon || "🎯";
  const targetDate = missionConfig?.target_date || "";
  const remaining = daysUntil(targetDate);
  const readiness = Math.max(0, Math.min(100, mission?.readiness || 0));

  let daysLabel = "No target date set";
  if (remaining !== null) {
    if (remaining > 0) daysLabel = `${remaining} day${remaining === 1 ? "" : "s"} to go`;
    else if (remaining === 0) daysLabel = "Target is today";
    else daysLabel = `${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"} past target`;
  }

  return (
    <section className="journey-hero-card">
      <RadialRing value={readiness} size={104} stroke={10} color={healthColor(readiness)} label={`${readiness}`} sublabel="Ready" />
      <div className="journey-hero-body">
        <p className="journey-hero-eyebrow">
          {icon} {title}
        </p>
        <div className="journey-hero-stats">
          <span className="journey-stat journey-stat-streak">
            🔥 {streaks?.current || 0}-day streak
          </span>
          <span className="journey-stat">{daysLabel}</span>
          <span className={`journey-stat journey-trajectory journey-trajectory-${(mission?.trajectory || "stable").toLowerCase().replace(/\s+/g, "-")}`}>
            {mission?.trajectory || "Stable"}
          </span>
        </div>
      </div>
    </section>
  );
}
