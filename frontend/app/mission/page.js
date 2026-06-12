"use client";
import { apiFetch } from "../lib/auth";

import { useEffect, useMemo, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import { buildRecentDates, daysSince } from "../lib/dateUtils";
import { heatLevel, radarPoints } from "../lib/vizUtils";
import { buildMissionExecution, buildMissionModel, ratioLabel } from "../lib/missionModel";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;

function sanitizeMissionTestRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    test_name: String(row?.test_name || ""),
    source: String(row?.source || ""),
    number_of_tests: Math.max(1, Number(row?.number_of_tests || 1)),
    revisions: Math.max(0, Number(row?.revisions || 0)),
  }));
}

export default function MissionControlPage() {
  const courseGroupIdRef = useRef(0);
  const nextCourseGroupId = () => {
    courseGroupIdRef.current += 1;
    return `course_group_${Date.now()}_${courseGroupIdRef.current}`;
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syllabus, setSyllabus] = useState({ exams: [] });
  const [activityByDate, setActivityByDate] = useState({});
  const [missionConfig, setMissionConfig] = useState(null);
  const [missionModalOpen, setMissionModalOpen] = useState(false);
  const [courseActionOpen, setCourseActionOpen] = useState("");
  const [editableRows, setEditableRows] = useState({
    course: {},
    book: {},
    random: {},
    test: {},
  });
  const [missionSaving, setMissionSaving] = useState(false);
  const [metricModal, setMetricModal] = useState({
    open: false,
    title: "",
    subtitle: "",
    columns: [],
    rows: [],
  });
  const [missionDraft, setMissionDraft] = useState({
    title: "",
    target_date: "",
    status: "active",
    plan: {
      courses: [],
      books: [],
      random: [],
      tests: [],
    },
  });
  const [battleDone, setBattleDone] = useState([false, false, false]);

  const loadMission = async () => {
    if (!API_BASE_URL) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/mission-control?lookback_days=90`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Mission API failed: ${res.status} ${txt}`);
      }
      const payload = await res.json();
      setSyllabus(payload?.syllabus || { exams: [] });
      setActivityByDate(payload?.activity_by_date || {});
      setMissionConfig(payload?.mission || null);
      setBattleDone([false, false, false]);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMission();
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [error]);

  useEffect(() => {
    if (!missionConfig) return;
    const rawCourses = Array.isArray(missionConfig?.plan?.courses) ? missionConfig.plan.courses : [];
    const groupByName = new Map();
    const coursesWithGroup = rawCourses.map((row) => {
      const existingGroup = String(row?.__group_id || "").trim();
      if (existingGroup) {
        return { ...row, __group_id: existingGroup };
      }
      const courseNameKey = String(row?.course_name || "").trim().toLowerCase();
      if (courseNameKey) {
        if (!groupByName.has(courseNameKey)) {
          groupByName.set(courseNameKey, nextCourseGroupId());
        }
        return { ...row, __group_id: groupByName.get(courseNameKey) };
      }
      return { ...row, __group_id: nextCourseGroupId() };
    });
    setMissionDraft({
      title: missionConfig.title || "",
      target_date: missionConfig.target_date || "",
      status: missionConfig.status || "active",
      plan: {
        courses: coursesWithGroup,
        books: Array.isArray(missionConfig?.plan?.books) ? missionConfig.plan.books : [],
        random: Array.isArray(missionConfig?.plan?.random) ? missionConfig.plan.random : [],
        tests: sanitizeMissionTestRows(missionConfig?.plan?.tests),
      },
    });
    setEditableRows({ course: {}, book: {}, random: {}, test: {} });
  }, [missionConfig]);

  const setRowEditable = (kind, idx, editable) => {
    setEditableRows((prev) => ({
      ...prev,
      [kind]: {
        ...(prev[kind] || {}),
        [idx]: Boolean(editable),
      },
    }));
  };

  const isRowEditable = (kind, idx) => Boolean(editableRows?.[kind]?.[idx]);

  const saveMission = async () => {
    if (!API_BASE_URL) return;
    setMissionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/mission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: missionDraft.title,
          target_date: missionDraft.target_date,
          status: missionDraft.status,
          plan: {
            ...missionDraft.plan,
            tests: sanitizeMissionTestRows(missionDraft?.plan?.tests),
          },
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Mission save failed: ${res.status} ${txt}`);
      }
      const payload = await res.json();
      setMissionConfig(payload?.mission || null);
      setMissionModalOpen(false);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setMissionSaving(false);
    }
  };

  const battleProgress = Math.round((battleDone.filter(Boolean).length / 3) * 100);

  const planExecution = useMemo(
    () => buildMissionExecution(missionConfig?.plan, syllabus),
    [missionConfig?.plan, syllabus],
  );
  const mission = useMemo(() => buildMissionModel(planExecution), [planExecution]);
  const wheelAxes = mission.axes?.length ? mission.axes : ["No Mission Dimension"];
  const radarValuesCoverage = wheelAxes.map((axis) => mission.axisStats[axis]?.coverage || 0);
  const radarValuesRetention = wheelAxes.map((axis) => mission.axisStats[axis]?.retention || 0);
  const radarValuesPerformance = wheelAxes.map((axis) => mission.axisStats[axis]?.performance || 0);
  const classVideoItems = useMemo(
    () =>
      [...(planExecution.classVideoItems || [])].sort((a, b) => {
        const c = a.course.localeCompare(b.course);
        if (c !== 0) return c;
        const s = a.subject.localeCompare(b.subject);
        if (s !== 0) return s;
        return a.classNo - b.classNo;
      }),
    [planExecution.classVideoItems],
  );
  const openMetricModal = (config) => {
    setMetricModal({
      open: true,
      title: config.title,
      subtitle: config.subtitle || "Done/Pending status list",
      columns: Array.isArray(config.columns) ? config.columns : [],
      rows: Array.isArray(config.rows) ? config.rows : [],
    });
  };
  const closeMetricModal = () => setMetricModal((prev) => ({ ...prev, open: false }));

  const metricCardConfigs = {
    courses: {
      title: "Course Status",
      columns: ["Course", "Status"],
      rows: (planExecution.courseItems || []).map((x) => [x.course, x.done ? "✔" : "✖"]),
    },
    subjects: {
      title: "Subject Status",
      columns: ["Course", "Subject", "Status"],
      rows: (planExecution.subjectItems || []).map((x) => [x.course, x.subject, x.done ? "✔" : "✖"]),
    },
    classes: {
      title: "Class Completion Status",
      columns: ["Course", "Subject", "Class", "Status"],
      rows: (planExecution.classItems || []).map((x) => [x.course, x.subject, `Class ${x.classNo}`, x.done ? "✔" : "✖"]),
    },
    classVideos: {
      title: "Class Video Status",
      columns: ["Course", "Subject", "Class", "Status"],
      rows: classVideoItems.map((x) => [x.course, x.subject, `Class ${x.classNo}`, x.done ? "✔" : "✖"]),
    },
    classNotes: {
      title: "Class Notes Status",
      columns: ["Course", "Subject", "Class", "Status"],
      rows: (planExecution.classNotesItems || []).map((x) => [x.course, x.subject, `Class ${x.classNo}`, x.done ? "✔" : "✖"]),
    },
    classRevisions: {
      title: "Class Revision Status",
      columns: ["Course", "Subject", "Class", "Progress", "Status"],
      rows: (planExecution.classRevisionItems || []).map((x) => [x.course, x.subject, `Class ${x.classNo}`, `${x.doneCount}/${x.totalCount}`, x.done ? "✔" : "✖"]),
    },
    books: {
      title: "Book Completion Status",
      columns: ["Book", "Status"],
      rows: (planExecution.bookItems || []).map((x) => [x.book, x.done ? "✔" : "✖"]),
    },
    chapters: {
      title: "Chapter Read Status",
      columns: ["Book", "Chapter", "Status"],
      rows: (planExecution.chapterItems || []).map((x) => [x.book, `Chapter ${x.chapterNo}`, x.done ? "✔" : "✖"]),
    },
    chapterNotes: {
      title: "Chapter Notes Status",
      columns: ["Book", "Chapter", "Status"],
      rows: (planExecution.chapterNotesItems || []).map((x) => [x.book, `Chapter ${x.chapterNo}`, x.done ? "✔" : "✖"]),
    },
    chapterRevisions: {
      title: "Chapter Revision Status",
      columns: ["Book", "Chapter", "Progress", "Status"],
      rows: (planExecution.chapterRevisionItems || []).map((x) => [x.book, `Chapter ${x.chapterNo}`, `${x.doneCount}/${x.totalCount}`, x.done ? "✔" : "✖"]),
    },
    randomTopics: {
      title: "Random Topic Completion Status",
      columns: ["Source", "Topic", "Status"],
      rows: (planExecution.randomItems || []).map((x) => [x.source, x.topic, x.done ? "✔" : "✖"]),
    },
    randomNotes: {
      title: "Random Notes Status",
      columns: ["Source", "Topic", "Status"],
      rows: (planExecution.randomNotesItems || []).map((x) => [x.source, x.topic, x.done ? "✔" : "✖"]),
    },
    randomRevisions: {
      title: "Random Revision Status",
      columns: ["Source", "Topic", "Progress", "Status"],
      rows: (planExecution.randomRevisionItems || []).map((x) => [x.source, x.topic, `${x.doneCount}/${x.totalCount}`, x.done ? "✔" : "✖"]),
    },
    testRows: {
      title: "Test Row Completion Status",
      columns: ["Source", "Test", "Status"],
      rows: (planExecution.testRowItems || []).map((x) => [x.source, x.testName, x.done ? "✔" : "✖"]),
    },
    testsGiven: {
      title: "Tests Given Status",
      columns: ["Source", "Test", "No.", "Status"],
      rows: (planExecution.testGivenItems || []).map((x) => [x.source, x.testName, String(x.testNumber), x.done ? "✔" : "✖"]),
    },
    testsAnalysis: {
      title: "Tests Analysis Status",
      columns: ["Source", "Test", "No.", "Status"],
      rows: (planExecution.testAnalysisItems || []).map((x) => [x.source, x.testName, String(x.testNumber), x.done ? "✔" : "✖"]),
    },
    testRevisions: {
      title: "Test Revision Status",
      columns: ["Source", "Test", "No.", "Progress", "Status"],
      rows: (planExecution.testRevisionItems || []).map((x) => [x.source, x.testName, String(x.testNumber), `${x.doneCount}/${x.totalCount}`, x.done ? "✔" : "✖"]),
    },
  };

  const recent45 = buildRecentDates(45);

  const identityCurrent = [
    mission.momentum.cls === "falling" ? "Irregular momentum" : "Momentum improving",
    mission.reviewRate < 50 ? "Weak test review loop" : "Tests are being reviewed",
    mission.revisionDebt > 20 ? "Revision debt growing" : "Revision debt controlled",
    mission.csatSafety === "Unsafe" ? "Test execution risk is high" : "Test execution trend is manageable",
  ];
  const identityTarget = [
    "Revises cyclically",
    "Attempts weekly tests",
    "Tracks and closes mistakes",
    "Protects test completion safety buffer",
  ];
  const courseRows = Array.isArray(missionDraft?.plan?.courses) ? missionDraft.plan.courses : [];
  const courseGroups = (() => {
    const groups = [];
    const map = new Map();
    courseRows.forEach((row, idx) => {
      const courseName = String(row?.course_name || "");
      const trimmed = courseName.trim();
      const rowGroupId = String(row?.__group_id || "").trim();
      const key = rowGroupId || (trimmed ? `name:${trimmed.toLowerCase()}` : `empty:${idx}`);
      if (!map.has(key)) {
        map.set(key, { key, course_name: courseName, rowIndexes: [] });
        groups.push(map.get(key));
      }
      map.get(key).rowIndexes.push(idx);
    });
    return groups;
  })();

  return (
    <main className="app-shell mission-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero mission-hero">
        <MainMenu active="mission" />
        <h1>Journey</h1>
        <p className="subtext">Where you are, where you&apos;re going, and what to do next.</p>

        {!API_BASE_URL ? <p className="api-state warn">Backend URL needed for Journey.</p> : null}
        {error ? <p className="api-state error">{error}</p> : null}
      </header>

      <section className="milestone-panel mission-controls">
        <div className="session-form-grid">
          <button className="btn-day" onClick={() => loadMission()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Mission"}
          </button>
          <button className="btn-day secondary" onClick={() => setMissionModalOpen(true)} disabled={loading}>
            Edit Mission
          </button>
        </div>

        {missionConfig ? (
          <div className="mission-status-grid" style={{ marginTop: 10 }}>
            <article className="mission-kpi"><h3>Mission</h3><p>{missionConfig.title || "UPSC Selection Mission"}</p></article>
            <article className="mission-kpi"><h3>Target Date</h3><p>{missionConfig.target_date || "-"}</p></article>
            <article className="mission-kpi"><h3>Status</h3><p>{missionConfig.status || "active"}</p></article>
            <article className="mission-kpi"><h3>Mission Progress</h3><p>{planExecution.progressPercent}%</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.courses)}><h3>Courses</h3><p>{ratioLabel(planExecution.coursesDone, planExecution.coursesTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.subjects)}><h3>Subjects</h3><p>{ratioLabel(planExecution.subjectsDone, planExecution.subjectsTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.classes)}><h3>Classes</h3><p>{ratioLabel(planExecution.classesDone, planExecution.classesTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.classVideos)}><h3>Class Videos</h3><p>{ratioLabel(planExecution.classVideosDone, planExecution.classVideosTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.classNotes)}><h3>Class Notes</h3><p>{ratioLabel(planExecution.classNotesDone, planExecution.classNotesTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.classRevisions)}><h3>Class Revisions</h3><p>{ratioLabel(planExecution.classRevisionsDone, planExecution.classRevisionsTotal)}</p></article>

            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.books)}><h3>Books</h3><p>{ratioLabel(planExecution.booksDone, planExecution.booksTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.chapters)}><h3>Chapters</h3><p>{ratioLabel(planExecution.chaptersDone, planExecution.chaptersTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.chapterNotes)}><h3>Chapter Notes</h3><p>{ratioLabel(planExecution.chapterNotesDone, planExecution.chapterNotesTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.chapterRevisions)}><h3>Chapter Revisions</h3><p>{ratioLabel(planExecution.chapterRevisionsDone, planExecution.chapterRevisionsTotal)}</p></article>

            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.randomTopics)}><h3>Random Topics</h3><p>{ratioLabel(planExecution.randomDone, planExecution.randomTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.randomNotes)}><h3>Random Notes</h3><p>{ratioLabel(planExecution.randomNotesDone, planExecution.randomNotesTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.randomRevisions)}><h3>Random Revisions</h3><p>{ratioLabel(planExecution.randomRevisionsDone, planExecution.randomRevisionsTotal)}</p></article>

            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.testRows)}><h3>Test Rows</h3><p>{ratioLabel(planExecution.testRowsDone, planExecution.testRowsTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.testsGiven)}><h3>Tests Given</h3><p>{ratioLabel(planExecution.testsGivenDone, planExecution.testsGivenTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.testsAnalysis)}><h3>Tests Analysis</h3><p>{ratioLabel(planExecution.testsAnalysisDone, planExecution.testsAnalysisTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.testRevisions)}><h3>Test Revisions</h3><p>{ratioLabel(planExecution.testRevisionsDone, planExecution.testRevisionsTotal)}</p></article>
          </div>
        ) : null}
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
            {wheelAxes.map((axis) => (
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
            <div className="story-kpi"><span>Tests safety</span><strong>{mission.csatSafety}</strong></div>
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

      {missionModalOpen ? (
        <div className="task-modal-overlay" onClick={() => setMissionModalOpen(false)}>
          <div className="task-modal" onClick={(e) => { e.stopPropagation(); setCourseActionOpen(""); }}>
            <h3>Edit Mission</h3>
            <p className="day-state" style={{ marginTop: 0 }}>
              Saved values are loaded as read-only. Use item Action -&gt; Edit to modify.
            </p>
            <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <label>
                <strong>Mission Title</strong>
                <input
                  className="task-select"
                  placeholder="Mission Title (e.g. UPSC Selection Mission)"
                  value={missionDraft.title}
                  onChange={(e) => setMissionDraft((prev) => ({ ...prev, title: e.target.value }))}
                />
              </label>
              <label>
                <strong>Target Date</strong>
                <input
                  className="task-select"
                  type="date"
                  value={missionDraft.target_date}
                  onChange={(e) => setMissionDraft((prev) => ({ ...prev, target_date: e.target.value }))}
                />
              </label>
              <label>
                <strong>Status</strong>
                <select
                  className="task-select"
                  value={missionDraft.status}
                  onChange={(e) => setMissionDraft((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </label>
            </div>
            <h4 style={{ marginBottom: 8 }}>Course Plan</h4>
            <p className="day-state" style={{ marginTop: 0 }}>
              Add one course, then add multiple subjects under it. Backend will store each subject as a separate row.
            </p>
            <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
              {courseGroups.map((group, gidx) => (
                <div key={group.key} className="content-modal-card" style={{ borderRadius: 12, padding: 12 }}>
                  <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto", opacity: 0.8 }}>
                    <small>Course</small>
                    <small>Subject</small>
                    <small>Classes</small>
                    <small>Revisions</small>
                    <small>Action</small>
                  </div>
                  {group.rowIndexes.map((rowIdx, idxInGroup) => {
                    const row = courseRows[rowIdx] || {};
                    const isFirstRow = idxInGroup === 0;
                    return (
                      <div
                        key={`course-${rowIdx}`}
                        className={`session-form-grid mission-plan-row ${isRowEditable("course", rowIdx) ? "is-editing" : "is-locked"}`}
                        style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto" }}
                      >
                        {isFirstRow ? (
                          <input
                            className="task-select"
                            placeholder="Course"
                            value={group.course_name || ""}
                            disabled={!isRowEditable("course", rowIdx)}
                            onChange={(e) =>
                              setMissionDraft((prev) => {
                                const list = [...(prev.plan.courses || [])];
                                group.rowIndexes.forEach((i) => {
                                  list[i] = { ...list[i], course_name: e.target.value };
                                });
                                return { ...prev, plan: { ...prev.plan, courses: list } };
                              })
                            }
                          />
                        ) : (
                          <div />
                        )}
                        <input
                          className="task-select"
                          placeholder="Subject"
                          value={row.subject_name || ""}
                          disabled={!isRowEditable("course", rowIdx)}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.courses || [])];
                              list[rowIdx] = { ...list[rowIdx], subject_name: e.target.value };
                              return { ...prev, plan: { ...prev.plan, courses: list } };
                            })
                          }
                        />
                        <input
                          className="task-select"
                          type="number"
                          min={1}
                          placeholder="Classes"
                          value={row.class_count ?? 1}
                          disabled={!isRowEditable("course", rowIdx)}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.courses || [])];
                              list[rowIdx] = { ...list[rowIdx], class_count: Number(e.target.value || 1) };
                              return { ...prev, plan: { ...prev.plan, courses: list } };
                            })
                          }
                        />
                        <input
                          className="task-select"
                          type="number"
                          min={0}
                          max={5}
                          placeholder="Revisions"
                          value={row.revision_count ?? 1}
                          disabled={!isRowEditable("course", rowIdx)}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.courses || [])];
                              list[rowIdx] = { ...list[rowIdx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                              return { ...prev, plan: { ...prev.plan, courses: list } };
                            })
                          }
                        />
                        <div style={{ position: "relative" }}>
                          <span className={`mission-row-state ${isRowEditable("course", rowIdx) ? "editing" : "locked"}`}>
                            {isRowEditable("course", rowIdx) ? "Editing" : "Locked"}
                          </span>
                          <button
                            className="btn-day secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              const key = `${group.key}:${rowIdx}`;
                              setCourseActionOpen((prev) => (prev === key ? "" : key));
                            }}
                          >
                            ...
                          </button>
                          {courseActionOpen === `${group.key}:${rowIdx}` ? (
                            <div
                              className="content-row-actions-menu"
                              style={{
                                position: "absolute",
                                right: 0,
                                top: "calc(100% + 4px)",
                                zIndex: 40,
                                minWidth: 170,
                                padding: 6,
                                borderRadius: 10,
                                border: "1px solid rgba(255,255,255,0.16)",
                                background: "rgba(15, 22, 40, 0.98)",
                                boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {!isRowEditable("course", rowIdx) ? (
                                <button
                                  className="content-row-action"
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    border: "none",
                                    background: "transparent",
                                    color: "#c7d2fe",
                                    fontWeight: 700,
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    cursor: "pointer",
                                  }}
                                  onClick={() => {
                                    setRowEditable("course", rowIdx, true);
                                    setCourseActionOpen("");
                                  }}
                                >
                                  Edit
                                </button>
                              ) : (
                                <button
                                  className="content-row-action"
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    border: "none",
                                    background: "transparent",
                                    color: "#86efac",
                                    fontWeight: 700,
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    cursor: "pointer",
                                  }}
                                  onClick={() => {
                                    setRowEditable("course", rowIdx, false);
                                    setCourseActionOpen("");
                                  }}
                                >
                                  Done
                                </button>
                              )}
                              <button
                                className="content-row-action danger"
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  border: "none",
                                  background: "transparent",
                                  color: "#fda4af",
                                  fontWeight: 700,
                                  padding: "8px 10px",
                                  borderRadius: 8,
                                  cursor: "pointer",
                                }}
                                onClick={() => {
                                  setMissionDraft((prev) => {
                                    const list = [...(prev.plan.courses || [])];
                                    list.splice(rowIdx, 1);
                                    return { ...prev, plan: { ...prev.plan, courses: list } };
                                  });
                                  setEditableRows((prev) => ({ ...prev, course: {} }));
                                  setCourseActionOpen("");
                                }}
                              >
                                Remove Subject
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  <button
                    className="btn-day secondary"
                    style={{ width: "100%" }}
                    onClick={() =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.courses || [])];
                        const sample = list[group.rowIndexes[0]] || {};
                        const newIndex = list.length;
                        list.push({
                          course_name: sample.course_name || "",
                          subject_name: "",
                          class_count: Number(sample.class_count || 1),
                          revision_count: Math.min(5, Number(sample.revision_count || 1)),
                          __group_id: sample.__group_id || nextCourseGroupId(),
                        });
                        setTimeout(() => setRowEditable("course", newIndex, true), 0);
                        return { ...prev, plan: { ...prev.plan, courses: list } };
                      })
                    }
                  >
                    + Add Subject
                  </button>
                </div>
              ))}
              <button
                className="btn-day secondary"
                style={{ width: "100%" }}
                onClick={() => {
                  const nextIndex = (missionDraft.plan.courses || []).length;
                  setMissionDraft((prev) => ({
                    ...prev,
                    plan: {
                      ...prev.plan,
                      courses: [
                        ...(prev.plan.courses || []),
                        { course_name: "", subject_name: "", class_count: 1, revision_count: 1, __group_id: nextCourseGroupId() },
                      ],
                    },
                  }));
                  setTimeout(() => setRowEditable("course", nextIndex, true), 0);
                }}
              >
                + Add Course
              </button>
            </div>
            <h4 style={{ marginBottom: 8, marginTop: 12 }}>Book Plan</h4>
            <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 1fr 1fr auto", opacity: 0.8 }}>
                <small>Book Name</small>
                <small>Chapters</small>
                <small>Revisions</small>
                <small>Action</small>
              </div>
              {(missionDraft.plan.books || []).map((row, idx) => (
                <div
                  key={`book-${idx}`}
                  className={`session-form-grid mission-plan-row ${isRowEditable("book", idx) ? "is-editing" : "is-locked"}`}
                  style={{ gridTemplateColumns: "2fr 1fr 1fr auto" }}
                >
                  <input
                    className="task-select"
                    placeholder="Book name"
                    value={row.book_name || ""}
                    disabled={!isRowEditable("book", idx)}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.books || [])];
                        list[idx] = { ...list[idx], book_name: e.target.value };
                        return { ...prev, plan: { ...prev.plan, books: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    type="number"
                    min={1}
                    placeholder="Chapters"
                    value={row.chapter_count ?? 1}
                    disabled={!isRowEditable("book", idx)}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.books || [])];
                        list[idx] = { ...list[idx], chapter_count: Number(e.target.value || 1) };
                        return { ...prev, plan: { ...prev.plan, books: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                          type="number"
                          min={0}
                          max={5}
                          placeholder="Revisions"
                          value={row.revision_count ?? 1}
                          disabled={!isRowEditable("book", idx)}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.books || [])];
                              list[idx] = { ...list[idx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                              return { ...prev, plan: { ...prev.plan, books: list } };
                            })
                          }
                        />
                  <div style={{ position: "relative" }}>
                    <button
                      className="btn-day secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = `book:${idx}`;
                        setCourseActionOpen((prev) => (prev === key ? "" : key));
                      }}
                    >
                      ...
                    </button>
                    {courseActionOpen === `book:${idx}` ? (
                      <div
                        className="content-row-actions-menu"
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "calc(100% + 4px)",
                          zIndex: 40,
                          minWidth: 170,
                          padding: 6,
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.16)",
                          background: "rgba(15, 22, 40, 0.98)",
                          boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!isRowEditable("book", idx) ? (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#c7d2fe",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("book", idx, true);
                              setCourseActionOpen("");
                            }}
                          >
                            Edit
                          </button>
                        ) : (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#86efac",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("book", idx, false);
                              setCourseActionOpen("");
                            }}
                          >
                            Done
                          </button>
                        )}
                        <button
                          className="content-row-action danger"
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: "none",
                            background: "transparent",
                            color: "#fda4af",
                            fontWeight: 700,
                            padding: "8px 10px",
                            borderRadius: 8,
                            cursor: "pointer",
                          }}
                          onClick={() => {
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.books || [])];
                              list.splice(idx, 1);
                              return { ...prev, plan: { ...prev.plan, books: list } };
                            });
                            setEditableRows((prev) => ({ ...prev, book: {} }));
                            setCourseActionOpen("");
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <button
                className="btn-day secondary"
                onClick={() => {
                  const nextIndex = (missionDraft.plan.books || []).length;
                  setMissionDraft((prev) => ({
                    ...prev,
                    plan: {
                      ...prev.plan,
                      books: [...(prev.plan.books || []), { book_name: "", chapter_count: 1, revision_count: 1 }],
                    },
                  }));
                  setTimeout(() => setRowEditable("book", nextIndex, true), 0);
                }}
              >
                + Add Book
              </button>
            </div>
            <h4 style={{ marginBottom: 8, marginTop: 12 }}>Random Plan</h4>
            <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr auto", opacity: 0.8 }}>
                <small>Source</small>
                <small>Topic</small>
                <small>Revisions</small>
                <small>Action</small>
              </div>
              {(missionDraft.plan.random || []).map((row, idx) => (
                <div
                  key={`random-${idx}`}
                  className={`session-form-grid mission-plan-row ${isRowEditable("random", idx) ? "is-editing" : "is-locked"}`}
                  style={{ gridTemplateColumns: "2fr 2fr 1fr auto" }}
                >
                  <input
                    className="task-select"
                    placeholder="Source"
                    value={row.source || ""}
                    disabled={!isRowEditable("random", idx)}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.random || [])];
                        list[idx] = { ...list[idx], source: e.target.value };
                        return { ...prev, plan: { ...prev.plan, random: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    placeholder="Topic name"
                    value={row.topic_name || ""}
                    disabled={!isRowEditable("random", idx)}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.random || [])];
                        list[idx] = { ...list[idx], topic_name: e.target.value };
                        return { ...prev, plan: { ...prev.plan, random: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                          type="number"
                          min={0}
                          max={5}
                          placeholder="Revisions"
                          value={row.revision_count ?? 1}
                          disabled={!isRowEditable("random", idx)}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.random || [])];
                              list[idx] = { ...list[idx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                              return { ...prev, plan: { ...prev.plan, random: list } };
                            })
                          }
                        />
                  <div style={{ position: "relative" }}>
                    <button
                      className="btn-day secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = `random:${idx}`;
                        setCourseActionOpen((prev) => (prev === key ? "" : key));
                      }}
                    >
                      ...
                    </button>
                    {courseActionOpen === `random:${idx}` ? (
                      <div
                        className="content-row-actions-menu"
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "calc(100% + 4px)",
                          zIndex: 40,
                          minWidth: 170,
                          padding: 6,
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.16)",
                          background: "rgba(15, 22, 40, 0.98)",
                          boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!isRowEditable("random", idx) ? (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#c7d2fe",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("random", idx, true);
                              setCourseActionOpen("");
                            }}
                          >
                            Edit
                          </button>
                        ) : (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#86efac",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("random", idx, false);
                              setCourseActionOpen("");
                            }}
                          >
                            Done
                          </button>
                        )}
                        <button
                          className="content-row-action danger"
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: "none",
                            background: "transparent",
                            color: "#fda4af",
                            fontWeight: 700,
                            padding: "8px 10px",
                            borderRadius: 8,
                            cursor: "pointer",
                          }}
                          onClick={() => {
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.random || [])];
                              list.splice(idx, 1);
                              return { ...prev, plan: { ...prev.plan, random: list } };
                            });
                            setEditableRows((prev) => ({ ...prev, random: {} }));
                            setCourseActionOpen("");
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <button
                className="btn-day secondary"
                onClick={() => {
                  const nextIndex = (missionDraft.plan.random || []).length;
                  setMissionDraft((prev) => ({
                    ...prev,
                    plan: {
                      ...prev.plan,
                      random: [...(prev.plan.random || []), { source: "", topic_name: "", revision_count: 1 }],
                    },
                  }));
                  setTimeout(() => setRowEditable("random", nextIndex, true), 0);
                }}
              >
                + Add Random Topic
              </button>
            </div>
            <h4 style={{ marginBottom: 8, marginTop: 12 }}>Test Plan</h4>
            <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <p className="day-state" style={{ marginTop: 0 }}>
                `Given` and `Analysis` are automatic defaults from `No. Tests`.
              </p>
              <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto", opacity: 0.8 }}>
                <small>Test</small>
                <small>Source</small>
                <small>No. Tests</small>
                <small>Revisions</small>
                <small>Action</small>
              </div>
              {(missionDraft.plan.tests || []).map((row, idx) => (
                <div
                  key={`test-${idx}`}
                  className={`session-form-grid mission-plan-row ${isRowEditable("test", idx) ? "is-editing" : "is-locked"}`}
                  style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto" }}
                >
                  <input
                    className="task-select"
                    placeholder="Test"
                    value={row.test_name || ""}
                    disabled={!isRowEditable("test", idx)}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.tests || [])];
                        list[idx] = { ...list[idx], test_name: e.target.value };
                        return { ...prev, plan: { ...prev.plan, tests: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    placeholder="Source"
                    value={row.source || ""}
                    disabled={!isRowEditable("test", idx)}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.tests || [])];
                        list[idx] = { ...list[idx], source: e.target.value };
                        return { ...prev, plan: { ...prev.plan, tests: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    type="number"
                    min={1}
                    placeholder="No. Tests"
                    value={row.number_of_tests ?? 1}
                    disabled={!isRowEditable("test", idx)}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.tests || [])];
                        list[idx] = { ...list[idx], number_of_tests: Number(e.target.value || 1) };
                        return { ...prev, plan: { ...prev.plan, tests: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    type="number"
                    min={0}
                    max={5}
                    placeholder="Revisions"
                    value={row.revisions ?? 0}
                    disabled={!isRowEditable("test", idx)}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.tests || [])];
                        list[idx] = { ...list[idx], revisions: Math.min(5, Number(e.target.value || 0)) };
                        return { ...prev, plan: { ...prev.plan, tests: list } };
                      })
                    }
                  />
                  <div style={{ position: "relative" }}>
                    <button
                      className="btn-day secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = `test:${idx}`;
                        setCourseActionOpen((prev) => (prev === key ? "" : key));
                      }}
                    >
                      ...
                    </button>
                    {courseActionOpen === `test:${idx}` ? (
                      <div
                        className="content-row-actions-menu"
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "calc(100% + 4px)",
                          zIndex: 40,
                          minWidth: 170,
                          padding: 6,
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.16)",
                          background: "rgba(15, 22, 40, 0.98)",
                          boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!isRowEditable("test", idx) ? (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#c7d2fe",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("test", idx, true);
                              setCourseActionOpen("");
                            }}
                          >
                            Edit
                          </button>
                        ) : (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#86efac",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("test", idx, false);
                              setCourseActionOpen("");
                            }}
                          >
                            Done
                          </button>
                        )}
                        <button
                          className="content-row-action danger"
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: "none",
                            background: "transparent",
                            color: "#fda4af",
                            fontWeight: 700,
                            padding: "8px 10px",
                            borderRadius: 8,
                            cursor: "pointer",
                          }}
                          onClick={() => {
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.tests || [])];
                              list.splice(idx, 1);
                              return { ...prev, plan: { ...prev.plan, tests: list } };
                            });
                            setEditableRows((prev) => ({ ...prev, test: {} }));
                            setCourseActionOpen("");
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <button
                className="btn-day secondary"
                onClick={() => {
                  const nextIndex = (missionDraft.plan.tests || []).length;
                  setMissionDraft((prev) => ({
                    ...prev,
                    plan: {
                      ...prev.plan,
                      tests: [
                        ...(prev.plan.tests || []),
                        {
                          test_name: "",
                          source: "",
                          number_of_tests: 1,
                          revisions: 0,
                        },
                      ],
                    },
                  }));
                  setTimeout(() => setRowEditable("test", nextIndex, true), 0);
                }}
              >
                + Add Test Plan
              </button>
            </div>
            <div className="task-modal-actions">
              <button className="btn-day secondary" onClick={() => setMissionModalOpen(false)} disabled={missionSaving}>
                Cancel
              </button>
              <button className="btn-day" onClick={saveMission} disabled={missionSaving}>
                {missionSaving ? "Saving..." : "Save Mission"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {metricModal.open ? (
        <div className="task-modal-overlay" onClick={closeMetricModal}>
          <div className="task-modal" style={{ maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h3>{metricModal.title}</h3>
            <p className="day-state" style={{ marginTop: 0 }}>
              {metricModal.subtitle}
            </p>
            <div
              className="session-form-grid"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, metricModal.columns.length)}, minmax(0, 1fr))`, opacity: 0.8 }}
            >
              {metricModal.columns.map((col) => <small key={col}>{col}</small>)}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {!metricModal.rows.length ? (
                <p className="day-state">No planned items found for this metric.</p>
              ) : (
                metricModal.rows.map((row, idx) => (
                  <div
                    key={`${metricModal.title}-${idx}`}
                    className="session-form-grid"
                    style={{ gridTemplateColumns: `repeat(${Math.max(1, metricModal.columns.length)}, minmax(0, 1fr))` }}
                  >
                    {row.map((cell, cIdx) => <span key={`${idx}-${cIdx}`}>{cell}</span>)}
                  </div>
                ))
              )}
            </div>
            <div className="task-modal-actions">
              <button className="btn-day secondary" onClick={closeMetricModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
