import { toIsoDate } from "./dateUtils";
import { dimensionCompletion } from "./missionModel";

function dayTotal(activityByDate, date) {
  const a = (activityByDate || {})[date] || {};
  return Number(a.study || 0) + Number(a.revision || 0) + Number(a.practice || 0);
}

// Current streak = consecutive active days ending today; longest = best run in the window.
export function buildStreaks(activityByDate, lookbackDays = 90) {
  const now = new Date();
  const totals = [];
  for (let i = lookbackDays - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    totals.push(dayTotal(activityByDate, toIsoDate(d)));
  }
  let current = 0;
  for (let i = totals.length - 1; i >= 0; i -= 1) {
    if (totals[i] > 0) current += 1;
    else break;
  }
  let longest = 0;
  let run = 0;
  totals.forEach((total) => {
    if (total > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  });
  return { current, longest: Math.max(longest, current) };
}

// Last 7 days of activity vs the 7 days before that.
export function buildWeekPulse(activityByDate) {
  const now = new Date();
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const iso = toIsoDate(d);
    days.push({ date: iso, dow: d.getDay(), total: dayTotal(activityByDate, iso) });
  }
  let prevTotal = 0;
  for (let i = 13; i >= 7; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    prevTotal += dayTotal(activityByDate, toIsoDate(d));
  }
  const weekTotal = days.reduce((acc, d) => acc + d.total, 0);
  let deltaPct = 0;
  if (prevTotal > 0) deltaPct = Math.round(((weekTotal - prevTotal) / prevTotal) * 100);
  else if (weekTotal > 0) deltaPct = 100;
  return { days, weekTotal, prevTotal, deltaPct };
}

// GitHub-style contribution columns: each column is one week (Sun..Sat).
export function buildContributionCalendar(activityByDate, weeks = 14) {
  const today = new Date();
  const totalDays = weeks * 7;
  const start = new Date(today);
  start.setDate(today.getDate() - (totalDays - 1));
  start.setDate(start.getDate() - start.getDay());

  const columns = [];
  const cursor = new Date(start);
  while (columns.length < weeks + 2 && cursor <= today) {
    const col = [];
    for (let dow = 0; dow < 7; dow += 1) {
      const iso = toIsoDate(cursor);
      const isFuture = cursor > today;
      col.push({
        date: iso,
        dow,
        month: cursor.getMonth(),
        total: isFuture ? null : dayTotal(activityByDate, iso),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push(col);
  }
  return columns.slice(-weeks);
}

export function heatLevelFor(total) {
  if (total === null || total === undefined) return "future";
  if (total <= 0) return 0;
  if (total === 1) return 1;
  if (total === 2) return 2;
  if (total <= 4) return 3;
  return 4;
}

// Per-area dimensions -> trail nodes with a state for the Journey path.
export function buildTrailNodes(dimensions) {
  const dims = Array.isArray(dimensions) ? dimensions : [];
  const completions = dims.map((dim) => dimensionCompletion(dim));
  let currentIdx = completions.findIndex((c) => c < 100);
  if (currentIdx === -1 && dims.length) currentIdx = dims.length - 1;

  return dims.map((dim, idx) => {
    const completion = completions[idx];
    const coveragePct = dim.coverageTotal ? Math.round((dim.coverageDone / dim.coverageTotal) * 100) : 100;
    const retentionPct = dim.retentionTotal ? Math.round((dim.retentionDone / dim.retentionTotal) * 100) : 100;
    const decaying = completion < 100 && coveragePct >= 50 && retentionPct < coveragePct - 25;
    let state = "upcoming";
    if (completion >= 100) state = "done";
    else if (decaying) state = "decaying";
    else if (idx === currentIdx) state = "current";
    return { ...dim, completion, decaying, state, isCurrent: idx === currentIdx };
  });
}

const BADGE_RULES = [
  { id: "streak3", icon: "🔥", label: "3-day streak", test: ({ streaks }) => streaks.longest >= 3 },
  { id: "streak7", icon: "⚡", label: "7-day streak", test: ({ streaks }) => streaks.longest >= 7 },
  { id: "streak14", icon: "🌟", label: "14-day streak", test: ({ streaks }) => streaks.longest >= 14 },
  { id: "first-mock", icon: "📝", label: "First mock attempted", test: ({ mission }) => (mission?.testsAttempted || 0) > 0 },
  { id: "reviewer", icon: "🔁", label: "Review loop closed", test: ({ mission }) => (mission?.reviewRate || 0) >= 80 },
  { id: "halfway", icon: "🏔️", label: "Halfway to goal", test: ({ mission }) => (mission?.readiness || 0) >= 50 },
  { id: "on-track", icon: "🚀", label: "On track", test: ({ mission }) => (mission?.readiness || 0) >= 70 },
  { id: "no-leaks", icon: "🛡️", label: "No active leaks", test: ({ mission }) => (mission?.leaks || []).length === 0 },
];

export function buildBadges({ mission, streaks }) {
  const ctx = { mission, streaks: streaks || { current: 0, longest: 0 } };
  return BADGE_RULES.map((rule) => ({ id: rule.id, icon: rule.icon, label: rule.label, earned: Boolean(rule.test(ctx)) }));
}

// Single highest-value sentence for the Coach's Note card.
export function buildCoachNote(mission) {
  if (!mission) return "Stay consistent — small daily blocks compound into readiness.";
  const worsened = mission.worsened || [];
  if (worsened.includes("Revision discipline")) {
    return "Your revision discipline slipped this week — lock in one recall block before starting anything new.";
  }
  if (worsened.includes("Practice pressure")) {
    return "Practice attempts dropped this week — add a timed test or recall sprint today.";
  }
  if (worsened.includes("Study rhythm")) {
    return "Study sessions slowed down this week — even one short focused block keeps momentum alive.";
  }
  if (mission.risk?.cls === "high") {
    return `Risk is running high right now. ${mission.riskText || "Close your oldest open revision first."}`;
  }
  if (mission.momentum?.cls === "rising") {
    return "Momentum is rising — keep the streak alive and protect your revision backlog at zero.";
  }
  return mission.identityDelta || "Stay consistent — small daily blocks compound into readiness.";
}
