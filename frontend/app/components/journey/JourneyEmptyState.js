"use client";

const POPULAR_CATEGORIES = ["UPSC", "Fitness", "Career", "Startup", "Skill"];

export default function JourneyEmptyState({ onCreate }) {
  return (
    <section className="milestone-panel journey-empty-state">
      <div className="journey-empty-icon">🧭</div>
      <h2>No journey yet</h2>
      <p>Your goals live here. Create your first one to get a path, milestones, and daily next actions.</p>
      <button className="btn-day" onClick={onCreate}>
        + Create journey
      </button>
      <p className="day-state" style={{ marginTop: 16 }}>
        Popular: {POPULAR_CATEGORIES.join(" · ")}
      </p>
    </section>
  );
}
