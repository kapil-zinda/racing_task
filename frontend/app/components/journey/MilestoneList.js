"use client";

import MilestoneCard from "./MilestoneCard";

export default function MilestoneList({ dimensions, onSelect }) {
  const dims = Array.isArray(dimensions) ? dimensions : [];

  if (!dims.length) {
    return <p className="day-state">No areas yet. Use Edit Journey to add courses, books, random topics, or tests.</p>;
  }

  return (
    <div className="milestone-list">
      {dims.map((dim) => (
        <MilestoneCard key={dim.key} dim={dim} onClick={() => onSelect?.(dim)} />
      ))}
    </div>
  );
}
