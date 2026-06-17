import { toIsoDate, daysSince } from "./dateUtils";
import { dimensionCompletion } from "./missionModel";
import { ensureNodeIds } from "../components/journey/journeyTreeOps";

function dayTotal(activityByDate, date) {
  const a = (activityByDate || {})[date] || {};
  return Number(a.study || 0) + Number(a.revision || 0) + Number(a.practice || 0) + Number(a.journey || 0);
}

function collectLeafNodes(nodes, journeyName, result = [], ancestors = []) {
  (nodes || []).forEach((node) => {
    if (!node.children || node.children.length === 0) {
      const counterMap = new Map();
      [...ancestors, node].forEach((n) => {
        (n.counters || []).forEach((c) => counterMap.set(c.key, Number(c.count || 0)));
      });
      const totalOccurrences = Array.from(counterMap.values()).reduce((sum, v) => sum + v, 0);
      result.push({ nodeId: node.id, label: node.label, journeyName, totalOccurrences });
    } else {
      collectLeafNodes(node.children, journeyName, result, [...ancestors, node]);
    }
  });
  return result;
}

export function buildJourneyActivityByDate(journeys, progressByJourney) {
  const byDate = {};
  Object.values(progressByJourney || {}).forEach((completions) => {
    (completions || []).forEach((c) => {
      if (!c.updated_at) return;
      const date = String(c.updated_at).slice(0, 10);
      if (!date) return;
      if (!byDate[date]) byDate[date] = { journey: 0 };
      byDate[date].journey += 1;
    });
  });
  return byDate;
}

export function buildJourneyDailySeries(journeys, progressByJourney, lookbackDays = 90) {
  const byDate = new Map();
  Object.entries(progressByJourney || {}).forEach(([, completions]) => {
    (completions || []).forEach((c) => {
      if (!c.updated_at || !c.node_id) return;
      const date = String(c.updated_at).slice(0, 10);
      if (!date) return;
      if (!byDate.has(date)) byDate.set(date, new Set());
      byDate.get(date).add(c.node_id);
    });
  });

  const today = new Date();
  const dates = [];
  const counts = [];
  for (let i = lookbackDays - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = toIsoDate(d);
    dates.push(iso);
    counts.push(byDate.has(iso) ? byDate.get(iso).size : 0);
  }
  return { dates, counts };
}

export function buildJourneyAttentionNodes(journeys, progressByJourney) {
  const list = [];
  (journeys || []).forEach((journey) => {
    const treeNodes = ensureNodeIds(Array.isArray(journey.plan?.structure) ? journey.plan.structure : []);
    const leaves = collectLeafNodes(treeNodes, journey.title || journey.id);
    const completions = progressByJourney?.[journey.id] || [];

    leaves.forEach(({ nodeId, label, journeyName, totalOccurrences }) => {
      if (totalOccurrences === 0) return;
      const nodeCompletions = completions.filter((c) => c.node_id === nodeId);
      if (nodeCompletions.length === 0) {
        list.push({ journeyName, label, lastTouched: null, daysSince: null, neverStarted: true });
        return;
      }
      const lastTouched = nodeCompletions.reduce((best, c) => {
        if (!c.updated_at) return best;
        return !best || c.updated_at > best ? c.updated_at : best;
      }, null);
      const ds = daysSince(lastTouched);
      if (ds >= 4) list.push({ journeyName, label, lastTouched, daysSince: ds, neverStarted: false });
    });
  });
  return list
    .sort((a, b) => {
      if (a.neverStarted !== b.neverStarted) return a.neverStarted ? 1 : -1;
      return (b.daysSince || 0) - (a.daysSince || 0);
    })
    .slice(0, 8);
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

// Daily count of DISTINCT leaf nodes (topics + test slots) updated on each date.
// Returns a continuous daily series over the last `lookbackDays` so the line reads as time.
export function buildDailyLeafNodeSeries(planExecution, lookbackDays = 90) {
  const topics = Array.isArray(planExecution?.missionTopics) ? planExecution.missionTopics : [];
  const tests = Array.isArray(planExecution?.missionTestSlots) ? planExecution.missionTestSlots : [];

  // date -> Set of leaf-node keys touched that day
  const byDate = new Map();
  const touch = (dateStr, nodeKey) => {
    if (!dateStr || !nodeKey) return;
    const d = String(dateStr).slice(0, 10);
    if (!d) return;
    if (!byDate.has(d)) byDate.set(d, new Set());
    byDate.get(d).add(nodeKey);
  };

  topics.forEach((t) => {
    touch(t.classDate, t.key);
    (Array.isArray(t.revisionDates) ? t.revisionDates : []).forEach((d) => touch(d, t.key));
  });
  tests.forEach((t) => {
    const key = `test||${t.source}||${t.testName}||${t.testNumber}`;
    touch(t.testGivenDate, key);
    touch(t.revisionDate, key);
    touch(t.secondRevisionDate, key);
  });

  const today = new Date();
  const dates = [];
  const counts = [];
  for (let i = lookbackDays - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = toIsoDate(d);
    dates.push(iso);
    counts.push(byDate.has(iso) ? byDate.get(iso).size : 0);
  }
  return { dates, counts };
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
