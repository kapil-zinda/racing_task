"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const PRELIMS_DATE = "2026-05-24";
const HOURS_PER_DAY = 15;
const FULL_TEST_TARGET = 17;
const FORUM_TARGET = 34;
const CAVA_TARGET = 25;
const AXES = [
  "Polity",
  "History",
  "Geography",
  "Economy",
  "Environment",
  "Science & Tech",
  "Current Affairs",
  "CSAT",
  "Essay",
  "Ethics",
  "Answer Writing",
  "Revision",
  "Mock Tests",
];

const AXIS_KEYWORDS = {
  Polity: ["polity", "constitution", "governance", "rights", "panchayati"],
  History: ["history", "modern", "art", "culture", "heritage", "world history", "medieval"],
  Geography: ["geography", "physical", "human", "world physical"],
  Economy: ["economy", "economic", "poverty", "inclusion", "development", "demographics"],
  Environment: ["environment", "ecology", "biodiversity", "climate"],
  "Science & Tech": ["science", "technology", "tech"],
  "Current Affairs": ["current affairs", "ca-va", "news"],
  CSAT: ["csat", "numeracy", "comprehension", "logical", "reasoning", "data interpretation"],
  Essay: ["essay"],
  Ethics: ["ethics", "integrity", "aptitude"],
  "Answer Writing": ["answer", "writing", "mains"],
  Revision: ["revision"],
  "Mock Tests": ["test", "mock", "sfg", "pmp", "cava"],
};

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysSince(value) {
  const d = toDate(value);
  if (!d) return 999;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function daysLeft() {
  const today = new Date();
  const exam = new Date(PRELIMS_DATE);
  return Math.max(0, Math.ceil((exam.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
}

function classifyAxis(exam, subject, topic) {
  const text = `${exam || ""} ${subject || ""} ${topic || ""}`.toLowerCase();
  for (const axis of AXES) {
    const keys = AXIS_KEYWORDS[axis] || [];
    if (keys.some((k) => text.includes(k))) return axis;
  }
  return "Revision";
}

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function buildRecentDates(total) {
  const dates = [];
  const now = new Date();
  for (let i = total - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    dates.push(toIsoDate(d));
  }
  return dates;
}

function scoreMomentum(recent, previous) {
  if (previous === 0 && recent === 0) return { label: "Flat", cls: "stable" };
  if (previous === 0 && recent > 0) return { label: "Rising", cls: "rising" };
  const ratio = (recent - previous) / previous;
  if (ratio > 0.2) return { label: "Rising", cls: "rising" };
  if (ratio < -0.2) return { label: "Falling", cls: "falling" };
  return { label: "Stable", cls: "stable" };
}

function riskBand(value) {
  if (value >= 70) return { label: "High", cls: "high" };
  if (value >= 40) return { label: "Medium", cls: "medium" };
  return { label: "Low", cls: "low" };
}

function heatLevel(value) {
  if (value <= 0) return 0;
  if (value === 1) return 1;
  if (value === 2) return 2;
  if (value <= 4) return 3;
  return 4;
}

function radarPoints(values, radius, cx, cy) {
  const step = (Math.PI * 2) / values.length;
  return values
    .map((v, i) => {
      const angle = -Math.PI / 2 + i * step;
      const r = (Math.max(0, Math.min(100, v)) / 100) * radius;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      return `${x},${y}`;
    })
    .join(" ");
}

function emptyAxisStats() {
  return AXES.reduce((acc, axis) => {
    acc[axis] = { total: 0, covered: 0, retentionSum: 0, perfSum: 0, readiness: 0, coverage: 0, retention: 0, performance: 0 };
    return acc;
  }, {});
}

function buildMissionModel(syllabus, activityByDate, userId) {
  const exams = syllabus?.exams || [];
  const topics = [];
  const tests = [];

  exams.forEach((examNode) => {
    (examNode.subjects || []).forEach((subjectNode) => {
      (subjectNode.topics || []).forEach((topicNode) => {
        const classDate = topicNode.class_study_first_date || "";
        const firstRev = topicNode.first_revision_date || "";
        const secondRev = topicNode.second_revision_date || "";
        const lastTouch = secondRev || firstRev || classDate || "";
        const axis = classifyAxis(examNode.exam, subjectNode.subject, topicNode.topic);
        topics.push({
          exam: examNode.exam,
          subject: subjectNode.subject,
          topic: topicNode.topic,
          classDate,
          firstRev,
          secondRev,
          lastTouch,
          axis,
          recordings: topicNode.recordings || [],
        });
      });
    });

    (examNode.tests || []).forEach((sourceNode) => {
      (sourceNode.tests || []).forEach((t) => {
        tests.push({
          exam: examNode.exam,
          source: sourceNode.source,
          testNumber: t.test_number,
          testGivenDate: t.test_given_date,
          revisionDate: t.revision_date,
          secondRevisionDate: t.second_revision_date,
          note: t.note || "",
        });
      });
    });
  });

  const totalTopics = topics.length;
  const coveredTopics = topics.filter((t) => Boolean(t.classDate)).length;
  const firstRevisedTopics = topics.filter((t) => Boolean(t.firstRev)).length;

  const coverageScore = totalTopics ? Math.round((coveredTopics / totalTopics) * 100) : 0;
  const retentionTopicScores = topics.map((t) => {
    if (!t.classDate) return 0;
    let score = 35;
    if (t.firstRev) score += 35;
    if (t.secondRev) score += 20;
    const staleDays = daysSince(t.lastTouch);
    if (staleDays <= 5) score += 10;
    else if (staleDays <= 12) score += 5;
    return Math.min(100, score);
  });
  const retentionScore = retentionTopicScores.length
    ? Math.round(retentionTopicScores.reduce((a, b) => a + b, 0) / retentionTopicScores.length)
    : 0;

  const testsAttempted = tests.filter((t) => Boolean(t.testGivenDate)).length;
  const testsReviewed = tests.filter((t) => Boolean(t.revisionDate || t.secondRevisionDate)).length;
  const reviewRate = testsAttempted ? Math.round((testsReviewed / testsAttempted) * 100) : 0;

  const recentDates = buildRecentDates(14);
  const previousDates = buildRecentDates(28).slice(0, 14);
  const sumWindow = (dates, key) => dates.reduce((acc, d) => acc + ((activityByDate[d] || {})[key] || 0), 0);
  const recentTotal = sumWindow(recentDates, "study") + sumWindow(recentDates, "revision") + sumWindow(recentDates, "practice");
  const previousTotal = sumWindow(previousDates, "study") + sumWindow(previousDates, "revision") + sumWindow(previousDates, "practice");
  const momentum = scoreMomentum(recentTotal, previousTotal);

  const practiceConsistency = Math.round((recentDates.filter((d) => ((activityByDate[d] || {}).practice || 0) > 0).length / recentDates.length) * 100);
  const performanceScore = Math.round((reviewRate * 0.55) + (practiceConsistency * 0.25) + (Math.min(100, (testsAttempted / FULL_TEST_TARGET) * 100) * 0.2));

  const readiness = Math.round((coverageScore * 0.45) + (retentionScore * 0.35) + (performanceScore * 0.2));

  const leaks = [];
  topics.forEach((t) => {
    if (t.classDate && !t.firstRev && daysSince(t.classDate) >= 7) {
      leaks.push({ severity: "high", title: `${t.topic}`, detail: `${t.subject} not revised for ${daysSince(t.classDate)} days.` });
    } else if (t.firstRev && !t.secondRev && daysSince(t.firstRev) >= 15) {
      leaks.push({ severity: "medium", title: `${t.topic}`, detail: `Second revision pending for ${daysSince(t.firstRev)} days.` });
    }
  });

  const subjectTouch = {};
  topics.forEach((t) => {
    const key = t.subject;
    const days = daysSince(t.lastTouch);
    if (!(key in subjectTouch) || days < subjectTouch[key]) subjectTouch[key] = days;
  });
  Object.entries(subjectTouch)
    .filter(([, d]) => d >= 5)
    .slice(0, 3)
    .forEach(([subject, d]) => {
      leaks.push({ severity: d > 10 ? "high" : "medium", title: `${subject}`, detail: `Not touched for ${d} days.` });
    });

  if (testsAttempted === 0) {
    leaks.push({ severity: "high", title: "Mock Frequency", detail: "No tests attempted yet. Start recall pressure now." });
  }
  if (practiceConsistency < 35) {
    leaks.push({ severity: "medium", title: "Practice Drift", detail: "Practice rhythm is low in last 14 days." });
  }

  const riskValue = Math.min(100, (leaks.filter((l) => l.severity === "high").length * 18) + (leaks.filter((l) => l.severity === "medium").length * 9) + Math.max(0, 50 - retentionScore));
  const risk = riskBand(riskValue);

  const axisStats = emptyAxisStats();
  topics.forEach((t) => {
    const s = axisStats[t.axis];
    s.total += 1;
    if (t.classDate) s.covered += 1;
    let topicRetention = 0;
    if (t.classDate) topicRetention += 35;
    if (t.firstRev) topicRetention += 35;
    if (t.secondRev) topicRetention += 20;
    if (daysSince(t.lastTouch) <= 7) topicRetention += 10;
    s.retentionSum += Math.min(100, topicRetention);

    let perf = 20;
    if (t.firstRev) perf += 25;
    if (t.secondRev) perf += 30;
    if ((t.recordings || []).length > 0) perf += 15;
    if (daysSince(t.lastTouch) <= 7) perf += 10;
    s.perfSum += Math.min(100, perf);
  });

  AXES.forEach((axis) => {
    const s = axisStats[axis];
    if (s.total === 0) return;
    s.coverage = Math.round((s.covered / s.total) * 100);
    s.retention = Math.round(s.retentionSum / s.total);
    s.performance = Math.round(s.perfSum / s.total);
    s.readiness = Math.round((s.coverage + s.retention + s.performance) / 3);
  });

  const battleTasks = [];
  const weakestAxis = AXES
    .map((axis) => ({ axis, score: axisStats[axis].readiness }))
    .sort((a, b) => a.score - b.score)[0];
  battleTasks.push({ type: "Study", text: `Finish 2 focused blocks in ${weakestAxis?.axis || "core weak area"}.` });

  const oldestLeak = leaks[0];
  battleTasks.push({ type: "Revise", text: oldestLeak ? `Revise ${oldestLeak.title} today to stop memory decay.` : "Revise one old topic and close a pending cycle." });
  battleTasks.push({ type: "Test / Recall", text: userId === "divya" ? "Attempt 25 MCQs + 1 short test review." : "Close 1 ticket-style recall sprint + self-quiz." });

  const timeline = topics
    .map((t) => {
      const d = daysSince(t.lastTouch || t.classDate);
      let zone = "grey";
      if (t.classDate) {
        if (d <= 5) zone = "green";
        else if (d <= 12) zone = "yellow";
        else zone = "red";
      }
      return { key: `${t.subject}-${t.topic}`, label: t.topic, zone, days: d };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 80);

  const forumDone = tests.filter((t) => (t.source || "").toLowerCase().includes("sfg")).length;
  const cavaDone = topics.filter((t) => `${t.subject} ${t.topic}`.toLowerCase().includes("current affairs")).length;
  const fullTestsLeft = Math.max(0, FULL_TEST_TARGET - testsAttempted);
  const forumLeft = Math.max(0, FORUM_TARGET - forumDone);
  const cavaLeft = Math.max(0, CAVA_TARGET - cavaDone);
  const revisionDebt = Math.max(0, coveredTopics - firstRevisedTopics);

  const recentStudy = sumWindow(recentDates, "study");
  const prevStudy = sumWindow(previousDates, "study");
  const recentRev = sumWindow(recentDates, "revision");
  const prevRev = sumWindow(previousDates, "revision");
  const recentPractice = sumWindow(recentDates, "practice");
  const prevPractice = sumWindow(previousDates, "practice");

  const improved = [];
  const worsened = [];
  if (recentStudy > prevStudy) improved.push("Study rhythm"); else if (recentStudy < prevStudy) worsened.push("Study rhythm");
  if (recentRev > prevRev) improved.push("Revision discipline"); else if (recentRev < prevRev) worsened.push("Revision discipline");
  if (recentPractice > prevPractice) improved.push("Practice pressure"); else if (recentPractice < prevPractice) worsened.push("Practice pressure");

  const trajectoryScore = (readiness * 0.5) + (momentum.cls === "rising" ? 30 : momentum.cls === "stable" ? 15 : 0) - (riskValue * 0.25);
  const trajectory = trajectoryScore >= 65 ? "Closer to goal" : trajectoryScore >= 45 ? "Stable" : trajectoryScore >= 30 ? "Drifting" : "Falling behind";

  const csatAxis = axisStats.CSAT;
  const csatSafety = csatAxis.readiness >= 65 ? "Safe" : csatAxis.readiness >= 45 ? "Borderline" : "Unsafe";

  const identityDelta = readiness >= 65 && momentum.cls !== "falling"
    ? "Your behavior is matching a serious ranker pattern."
    : readiness >= 45
      ? "You are in recoverable zone, but revision consistency must harden."
      : "You are behaving more like a learner than a qualifier right now.";

  return {
    readiness,
    momentum,
    risk,
    riskText: leaks.slice(0, 2).map((l) => l.detail).join(" ") || "No major leakage detected.",
    axisStats,
    leaks: leaks.slice(0, 8),
    battleTasks,
    timeline,
    testsAttempted,
    reviewRate,
    performanceScore,
    fullTestsLeft,
    forumLeft,
    cavaLeft,
    revisionDebt,
    improved,
    worsened,
    trajectory,
    csatSafety,
    identityDelta,
  };
}

export default function MissionControlPage() {
  const [userId, setUserId] = useState("divya");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syllabus, setSyllabus] = useState({ exams: [] });
  const [activityByDate, setActivityByDate] = useState({});
  const [battleDone, setBattleDone] = useState([false, false, false]);

  const loadMission = async (nextUser = userId) => {
    if (!API_BASE_URL) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE_URL}/mission-control?user_id=${encodeURIComponent(nextUser)}&lookback_days=90`
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Mission API failed: ${res.status} ${txt}`);
      }
      const payload = await res.json();
      setSyllabus(payload?.syllabus || { exams: [] });
      setActivityByDate(payload?.activity_by_date || {});
      setBattleDone([false, false, false]);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMission("divya");
  }, []);

  const mission = useMemo(() => buildMissionModel(syllabus, activityByDate, userId), [syllabus, activityByDate, userId]);

  const dayLeftCount = daysLeft();
  const hourLeftCount = dayLeftCount * HOURS_PER_DAY;
  const battleProgress = Math.round((battleDone.filter(Boolean).length / 3) * 100);

  const radarValuesCoverage = AXES.map((axis) => mission.axisStats[axis]?.coverage || 0);
  const radarValuesRetention = AXES.map((axis) => mission.axisStats[axis]?.retention || 0);
  const radarValuesPerformance = AXES.map((axis) => mission.axisStats[axis]?.performance || 0);

  const recent45 = buildRecentDates(45);

  const identityCurrent = [
    mission.momentum.cls === "falling" ? "Irregular momentum" : "Momentum improving",
    mission.reviewRate < 50 ? "Weak test review loop" : "Tests are being reviewed",
    mission.revisionDebt > 20 ? "Revision debt growing" : "Revision debt controlled",
    mission.csatSafety === "Unsafe" ? "CSAT risk is high" : "CSAT trend is manageable",
  ];
  const identityTarget = [
    "Revises cyclically",
    "Attempts weekly tests",
    "Tracks and closes mistakes",
    "Protects CSAT safety buffer",
  ];

  return (
    <main className="app-shell mission-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero mission-hero">
        <div className="top-nav-links">
          <Link href="/" className="top-nav-link">Home</Link>
          <Link href="/recorder" className="top-nav-link">Recorder</Link>
          <Link href="/syllabus" className="top-nav-link">Syllabus</Link>
          <Link href="/mission" className="top-nav-link active">Mission</Link>
        </div>
        <p className="badge">UPSC War Room</p>
        <h1>UPSC Mission Control</h1>
        <p className="subtext">Distance to selection, leakage, daily battle and trajectory in one view.</p>

        {!API_BASE_URL ? <p className="api-state warn">Backend URL needed for Mission Control.</p> : null}
        {error ? <p className="api-state error">{error}</p> : null}
      </header>

      <section className="milestone-panel mission-controls">
        <div className="session-form-grid">
          <select
            className="task-select"
            value={userId}
            onChange={async (e) => {
              const next = e.target.value;
              setUserId(next);
              await loadMission(next);
            }}
          >
            <option value="kapil">Kapil</option>
            <option value="divya">Divya</option>
          </select>
          <button className="btn-day" onClick={() => loadMission(userId)} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Mission"}
          </button>
        </div>

        <div className="mission-status-grid">
          <article className="mission-kpi"><h3>Days Left</h3><p>{dayLeftCount}</p></article>
          <article className="mission-kpi"><h3>Hours Left</h3><p>{hourLeftCount}</p></article>
          <article className="mission-kpi"><h3>Full Tests Left</h3><p>{mission.fullTestsLeft}</p></article>
          <article className="mission-kpi"><h3>Forum Targets Left</h3><p>{mission.forumLeft}</p></article>
          <article className="mission-kpi"><h3>CA-VA Left</h3><p>{mission.cavaLeft}</p></article>
          <article className="mission-kpi"><h3>Revision Debt</h3><p>{mission.revisionDebt}</p></article>
        </div>
      </section>

      <section className="milestone-panel summit-panel">
        <div className="summit-header">
          <div>
            <h2>Distance To UPSC Selection</h2>
            <p className="day-state">Am I moving closer to selection?</p>
          </div>
          <div className="trajectory-chip">{mission.trajectory}</div>
        </div>
        <div className="summit-metrics">
          <div><span>Readiness</span><strong>{mission.readiness} / 100</strong></div>
          <div><span>Momentum</span><strong className={`momentum-${mission.momentum.cls}`}>{mission.momentum.label}</strong></div>
          <div><span>Risk</span><strong className={`risk-${mission.risk.cls}`}>{mission.risk.label}</strong></div>
        </div>
        <div className="summit-path-wrap">
          <div className="summit-path">
            <div className="summit-fill" style={{ width: `${mission.readiness}%` }} />
            <div className={`summit-fog fog-${mission.risk.cls}`} />
            <div className="summit-marker" style={{ left: `${Math.max(4, mission.readiness)}%` }} />
            <div className="summit-goal">UPSC Selection</div>
          </div>
          <p className="risk-summary">Risk insight: {mission.riskText}</p>
        </div>
      </section>

      <section className="mission-main-grid">
        <article className="milestone-panel radar-panel">
          <h2>UPSC Wheel</h2>
          <p className="day-state">Coverage + Retention + Performance balance</p>
          <svg viewBox="0 0 340 340" className="radar-svg" role="img" aria-label="UPSC readiness radar">
            <circle cx="170" cy="170" r="120" className="radar-ring" />
            <circle cx="170" cy="170" r="90" className="radar-ring" />
            <circle cx="170" cy="170" r="60" className="radar-ring" />
            <circle cx="170" cy="170" r="30" className="radar-ring" />
            <polygon points={radarPoints(radarValuesCoverage, 120, 170, 170)} className="radar-poly coverage" />
            <polygon points={radarPoints(radarValuesRetention, 120, 170, 170)} className="radar-poly retention" />
            <polygon points={radarPoints(radarValuesPerformance, 120, 170, 170)} className="radar-poly performance" />
          </svg>
          <div className="radar-legend">
            <span><i className="dot radar-dot-coverage" />Coverage</span>
            <span><i className="dot radar-dot-retention" />Retention</span>
            <span><i className="dot radar-dot-performance" />Performance</span>
          </div>
          <div className="axis-mini-grid">
            {AXES.map((axis) => (
              <div key={axis} className="axis-mini-card">
                <strong>{axis}</strong>
                <div className="axis-bars">
                  <span style={{ width: `${mission.axisStats[axis]?.coverage || 0}%` }} className="bar coverage" />
                  <span style={{ width: `${mission.axisStats[axis]?.retention || 0}%` }} className="bar retention" />
                  <span style={{ width: `${mission.axisStats[axis]?.performance || 0}%` }} className="bar performance" />
                </div>
              </div>
            ))}
          </div>
        </article>

        <aside className="mission-side-stack">
          <article className="milestone-panel leak-panel">
            <h2>Danger Zone</h2>
            <p className="day-state">What is slipping out of control?</p>
            <div className="leak-list">
              {mission.leaks.length === 0 ? <p className="day-state">No major leaks detected. Keep consistency alive.</p> : mission.leaks.map((leak, idx) => (
                <div key={`${leak.title}-${idx}`} className={`leak-card ${leak.severity}`}>
                  <h4>{leak.title}</h4>
                  <p>{leak.detail}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="milestone-panel battle-panel">
            <h2>Today’s Battle Card</h2>
            <p className="day-state">What should I do today?</p>
            <div className="battle-list">
              {mission.battleTasks.map((task, idx) => (
                <button
                  key={`${task.type}-${idx}`}
                  className={`battle-task ${battleDone[idx] ? "done" : ""}`}
                  onClick={() => setBattleDone((prev) => prev.map((v, i) => (i === idx ? !v : v)))}
                >
                  <span className="battle-type">{task.type}</span>
                  <span>{task.text}</span>
                </button>
              ))}
            </div>
            <div className="battle-progress">
              <div className="battle-progress-fill" style={{ width: `${battleProgress}%` }} />
            </div>
            <p className="day-state">Mission completion: {battleProgress}%</p>
          </article>
        </aside>
      </section>

      <section className="mission-lower-grid">
        <article className="milestone-panel">
          <h2>Revision Decay Timeline</h2>
          <p className="day-state">Green recent, yellow due, red fading, grey untouched.</p>
          <div className="decay-strip">
            {mission.timeline.map((item) => (
              <div key={item.key} className={`decay-block ${item.zone}`} title={`${item.label} • ${item.days} days`} />
            ))}
          </div>
        </article>

        <article className="milestone-panel">
          <h2>Test Performance Story</h2>
          <p className="day-state">Effort-output relationship, not marks only.</p>
          <div className="story-grid">
            <div className="story-kpi"><span>Tests attempted</span><strong>{mission.testsAttempted}</strong></div>
            <div className="story-kpi"><span>Review completion</span><strong>{mission.reviewRate}%</strong></div>
            <div className="story-kpi"><span>Performance index</span><strong>{mission.performanceScore}</strong></div>
            <div className="story-kpi"><span>CSAT safety</span><strong>{mission.csatSafety}</strong></div>
          </div>
          <div className="river-chart">
            <div className="river-flow green" style={{ width: `${Math.max(8, mission.performanceScore)}%` }} />
            <div className="river-flow red" style={{ width: `${Math.max(5, 100 - mission.reviewRate)}%` }} />
            <div className="river-stones" style={{ width: `${Math.max(5, mission.revisionDebt)}%` }} />
          </div>
          <div className="river-labels">
            <span>Green: growth</span>
            <span>Red: careless/missed review</span>
            <span>Dark: repeated weak zones</span>
          </div>
        </article>

        <article className="milestone-panel">
          <h2>Consistency Heatmaps</h2>
          <p className="day-state">Study vs Revision vs Practice balance.</p>
          <div className="heatmap-group">
            {["study", "revision", "practice"].map((kind) => (
              <div key={kind} className="heatmap-row">
                <strong>{kind[0].toUpperCase() + kind.slice(1)}</strong>
                <div className="heatmap-grid">
                  {recent45.map((date) => {
                    const v = (activityByDate[date] || {})[kind] || 0;
                    return <span key={`${kind}-${date}`} className={`heat-cell level-${heatLevel(v)}`} title={`${date}: ${v}`} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="mission-lower-grid">
        <article className="milestone-panel">
          <h2>Identity Reflection</h2>
          <p className="day-state">How different am I from the person who will clear UPSC?</p>
          <div className="identity-grid">
            <div>
              <h4>Current You</h4>
              <ul>
                {identityCurrent.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div>
              <h4>Clearing You</h4>
              <ul>
                {identityTarget.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
          <p className="identity-delta">{mission.identityDelta}</p>
        </article>

        <article className="milestone-panel">
          <h2>Weekly Trajectory</h2>
          <div className="trajectory-status">{mission.trajectory}</div>
          <div className="trajectory-cols">
            <div>
              <h4>What Improved</h4>
              <ul>
                {(mission.improved.length ? mission.improved : ["No clear improvement this week"]).map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
            <div>
              <h4>What Worsened</h4>
              <ul>
                {(mission.worsened.length ? mission.worsened : ["No major decline this week"]).map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
            <div>
              <h4>One Correction</h4>
              <p>
                {mission.worsened.includes("Revision discipline")
                  ? "Lock 2 fixed revision blocks daily before new study."
                  : mission.worsened.includes("Practice pressure")
                    ? "Add one timed recall/test block every day for 14 days."
                    : "Keep the current tempo and protect review backlog at zero."}
              </p>
            </div>
          </div>
        </article>

        <article className="milestone-panel projection-panel">
          <h2>14-Day Projection</h2>
          <p className="day-state">What happens if you continue like this?</p>
          <ul>
            <li>Likely readiness after 14 days: <strong>{Math.min(100, mission.readiness + (mission.momentum.cls === "rising" ? 8 : mission.momentum.cls === "stable" ? 3 : -5))}</strong></li>
            <li>Topics entering forgetting zone: <strong>{mission.timeline.filter((t) => t.zone === "red").length}</strong></li>
            <li>Expected revision debt drift: <strong>{mission.momentum.cls === "falling" ? "+6 topics" : mission.momentum.cls === "stable" ? "+2 topics" : "-3 topics"}</strong></li>
            <li>Mock readiness outlook: <strong>{mission.testsAttempted >= 8 ? "Recoverable" : "At risk"}</strong></li>
          </ul>
        </article>
      </section>
    </main>
  );
}
