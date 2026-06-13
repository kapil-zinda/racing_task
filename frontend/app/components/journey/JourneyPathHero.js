"use client";

import { daysUntil } from "../../lib/dateUtils";
import { dimensionCompletion } from "../../lib/missionModel";

export default function JourneyPathHero({ missionConfig, mission, planExecution, onSelectMilestone }) {
  const title = missionConfig?.title || "Your Journey";
  const icon = missionConfig?.icon || "🎯";
  const targetDate = missionConfig?.target_date || "";
  const remaining = daysUntil(targetDate);
  const dimensions = Array.isArray(planExecution?.dimensions) ? planExecution.dimensions : [];
  const readiness = Math.max(0, Math.min(100, mission?.readiness || 0));

  let daysLabel = "No target date set yet";
  if (remaining !== null) {
    if (remaining > 0) daysLabel = `${remaining} day${remaining === 1 ? "" : "s"} to go`;
    else if (remaining === 0) daysLabel = "Target date is today";
    else daysLabel = `${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"} past target`;
  }

  const completions = dimensions.map((dim) => dimensionCompletion(dim));
  let currentIdx = completions.findIndex((c) => c < 100);
  if (currentIdx === -1 && dimensions.length) currentIdx = dimensions.length - 1;

  return (
    <section className="milestone-panel journey-hero">
      <div className="summit-header">
        <div>
          <h2>{icon} {title}</h2>
          <p className="day-state">
            {daysLabel}
            {targetDate ? ` · Target: ${targetDate}` : ""}
          </p>
        </div>
        <div className="trajectory-chip">{mission?.trajectory || "Stable"}</div>
      </div>

      <div className="journey-path-wrap">
        <div className="journey-path">
          <div className="journey-path-track" />
          <div className="journey-path-fill" style={{ width: `${readiness}%` }} />
          {dimensions.map((dim, idx) => {
            const completion = completions[idx];
            const pos = ((idx + 1) / (dimensions.length + 1)) * 100;
            const state = completion >= 100 ? "done" : idx === currentIdx ? "current" : "upcoming";
            return (
              <button
                key={dim.key}
                type="button"
                className={`path-milestone ${state}`}
                style={{ left: `${pos}%` }}
                title={`${dim.label} · ${completion}%`}
                aria-label={`${dim.label}, ${completion}% complete`}
                onClick={() => onSelectMilestone?.(dim)}
              />
            );
          })}
          <div
            className="journey-path-now"
            style={{ left: `${Math.max(2, Math.min(98, readiness))}%` }}
            title={`You are here · ${readiness}/100`}
          />
          <div className="journey-path-goal">🏁 Goal</div>
        </div>
        <div className="journey-path-label">
          <span>Readiness: {readiness}/100</span>
          <span className={`momentum-${mission?.momentum?.cls || "stable"}`}>
            Momentum: {mission?.momentum?.label || "Stable"}
          </span>
          <span className={`risk-${mission?.risk?.cls || "low"}`}>Risk: {mission?.risk?.label || "Low"}</span>
        </div>
      </div>
    </section>
  );
}
