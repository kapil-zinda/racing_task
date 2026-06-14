"use client";

import { buildCoachNote } from "../../lib/journeyInsights";

export default function CoachNote({ mission }) {
  const note = buildCoachNote(mission);
  return (
    <article className="hub-card hub-coach">
      <span className="hub-coach-icon" aria-hidden="true">🧭</span>
      <p>{note}</p>
    </article>
  );
}
