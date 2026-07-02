"use client";
// A single goal card in the goals list: icon, name, progress ring, deadline, status.

import Link from "next/link";

function daysLeft(endDate) {
  if (!endDate) return null;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return null;
  const diff = Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24));
  return diff;
}

export default function GoalCard({ goal, onDelete }) {
  const pct = Math.round(goal.progress || 0);
  const dl = daysLeft(goal.end_date);
  const color = goal.color || "#6366f1";

  return (
    <div className="goal-card" style={{ "--goal-color": color }}>
      <Link href={`/goals/${goal.id}`} className="goal-card-main">
        <div className="goal-card-top">
          <span className="goal-card-icon">{goal.icon || "🎯"}</span>
          <span className={`goal-status-chip s-${goal.status}`}>{goal.status}</span>
        </div>
        <div className="goal-card-name">{goal.name}</div>
        {goal.description && <div className="goal-card-desc">{goal.description}</div>}
        <div className="goal-card-progress">
          <div className="goal-progress-bar"><span style={{ width: `${pct}%` }} /></div>
          <span className="goal-progress-num">{pct}%</span>
        </div>
        <div className="goal-card-meta">
          <span>{goal.category || "General"}</span>
          {dl !== null && (
            <span className={dl < 0 ? "overdue" : ""}>
              {dl < 0 ? `${Math.abs(dl)}d overdue` : dl === 0 ? "due today" : `${dl}d left`}
            </span>
          )}
        </div>
      </Link>
      <div className="goal-card-actions">
        <button className="goal-icon-btn danger" title="Delete goal"
                onClick={() => onDelete(goal)}>🗑</button>
      </div>
    </div>
  );
}
