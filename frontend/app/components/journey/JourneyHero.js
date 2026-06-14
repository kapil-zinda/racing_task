"use client";

import { useRouter } from "next/navigation";
import { daysUntil } from "../../lib/dateUtils";
import JourneyActionsMenu from "./JourneyActionsMenu";
import { countTreeNodes } from "./JourneyTreeBuilder";

export default function JourneyHero({ journey, onTogglePause, onDelete, busy }) {
  const router = useRouter();
  const title = journey?.title || "Your Journey";
  const icon = journey?.icon || "🎯";
  const targetDate = journey?.target_date || "";
  const remaining = daysUntil(targetDate);
  const itemCount = countTreeNodes(journey?.plan?.structure);
  const isPaused = (journey?.status || "").toLowerCase() === "paused";

  let daysLabel = "No target date set";
  if (remaining !== null) {
    if (remaining > 0) daysLabel = `${remaining} day${remaining === 1 ? "" : "s"} to go`;
    else if (remaining === 0) daysLabel = "Target is today";
    else daysLabel = `${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"} past target`;
  }

  const handleCardClick = () => {
    if (journey?.id) router.push(`/mission/${journey.id}`);
  };

  return (
    <section
      className="journey-hero-card clickable"
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleCardClick();
      }}
    >
      <JourneyActionsMenu status={journey?.status} onTogglePause={onTogglePause} onDelete={onDelete} busy={busy} />
      <div className="journey-hero-icon" aria-hidden="true">{icon}</div>
      <div className="journey-hero-body">
        <p className="journey-hero-eyebrow">
          {icon} {title}
        </p>
        <div className="journey-hero-stats">
          <span className="journey-stat">{daysLabel}</span>
          <span className="journey-stat">🧭 {itemCount} topic{itemCount === 1 ? "" : "s"}</span>
          {isPaused ? <span className="journey-stat journey-stat-paused">Paused</span> : null}
        </div>
      </div>
    </section>
  );
}
