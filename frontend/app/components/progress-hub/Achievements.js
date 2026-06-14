"use client";

import { buildBadges } from "../../lib/journeyInsights";

export default function Achievements({ mission, streaks }) {
  const badges = buildBadges({ mission, streaks });
  return (
    <article className="hub-card hub-achievements">
      <h3>Achievements</h3>
      <div className="badge-row">
        {badges.map((b) => (
          <span key={b.id} className={`badge-chip ${b.earned ? "earned" : ""}`} title={b.label}>
            <span className="badge-chip-icon" aria-hidden="true">{b.icon}</span> {b.label}
          </span>
        ))}
      </div>
    </article>
  );
}
