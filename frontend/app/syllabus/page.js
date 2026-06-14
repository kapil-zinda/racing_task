"use client";
import { apiFetch } from "../lib/auth";

import { useEffect, useMemo, useState } from "react";
import MainMenu from "../components/MainMenu";
import { buildMissionExecution, buildMissionModel } from "../lib/missionModel";
import { buildDummyMissionControl, DUMMY_DATA_NOTICE } from "../lib/dummyData";
import { buildStreaks, buildWeekPulse } from "../lib/journeyInsights";
import HubTabs from "../components/progress-hub/HubTabs";
import GoalHealthHero from "../components/progress-hub/GoalHealthHero";
import WeekPulse from "../components/progress-hub/WeekPulse";
import ContributionCalendar from "../components/progress-hub/ContributionCalendar";
import FocusBalance from "../components/progress-hub/FocusBalance";
import NeedsAttention from "../components/progress-hub/NeedsAttention";
import CoachNote from "../components/progress-hub/CoachNote";
import Achievements from "../components/progress-hub/Achievements";
import TestStoryPanel from "../components/progress-hub/TestStoryPanel";
import DimensionProgressGrid from "../components/progress-hub/DimensionProgressGrid";
import SyllabusTree from "../components/progress-hub/SyllabusTree";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;

const HUB_TABS = [
  { key: "overview", label: "Overview", icon: "📊" },
  { key: "tests", label: "Tests", icon: "📝" },
  { key: "detail", label: "Detail", icon: "📚" },
];

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

export default function ProgressHubPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syllabus, setSyllabus] = useState({ exams: [] });
  const [activityByDate, setActivityByDate] = useState({});
  const [missionConfig, setMissionConfig] = useState(null);
  const [usingDummy, setUsingDummy] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [playbackByKey, setPlaybackByKey] = useState({});
  const [playbackLoadingKey, setPlaybackLoadingKey] = useState("");

  const applyDummyData = () => {
    const dummy = buildDummyMissionControl();
    setSyllabus(dummy.syllabus);
    setActivityByDate(dummy.activity_by_date);
    setMissionConfig(dummy.mission);
    setUsingDummy(true);
  };

  const loadProgress = async () => {
    if (!API_BASE_URL) {
      applyDummyData();
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/mission-control?lookback_days=90`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Progress API failed: ${res.status} ${txt}`);
      }
      const payload = await res.json();
      const liveSyllabus = payload?.syllabus || { exams: [] };
      const liveMission = payload?.mission || null;
      const liveActivity = payload?.activity_by_date || {};
      const hasData = (liveSyllabus.exams || []).length > 0 || Boolean(liveMission);
      if (!hasData) {
        applyDummyData();
      } else {
        setSyllabus(liveSyllabus);
        setActivityByDate(liveActivity);
        setMissionConfig(liveMission);
        setUsingDummy(false);
      }
      setPlaybackByKey({});
    } catch (err) {
      setError(String(err.message || err));
      applyDummyData();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProgress();
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [error]);

  const planExecution = useMemo(
    () => buildMissionExecution(missionConfig?.plan, syllabus),
    [missionConfig?.plan, syllabus],
  );
  const mission = useMemo(() => buildMissionModel(planExecution), [planExecution]);
  const streaks = useMemo(() => buildStreaks(activityByDate), [activityByDate]);
  const weekPulse = useMemo(() => buildWeekPulse(activityByDate), [activityByDate]);

  const globalTestsBySource = useMemo(() => {
    const exams = Array.isArray(syllabus?.exams) ? syllabus.exams : [];
    const bySource = new Map();
    const recordingIndex = new Map();

    exams.forEach((exam) => {
      const examName = exam?.exam || "General";
      (exam?.subjects || []).forEach((subject) => {
        const subjectName = subject?.subject || "General";
        (subject?.topics || []).forEach((topic) => {
          const topicName = topic?.topic || "General";
          const recordings = (topic?.recordings || [])
            .filter((rec) => rec?.session_id && rec?.default_media_type)
            .map((rec, idx) => ({
              key: `test-rec-${norm(examName)}-${norm(subjectName)}-${norm(topicName)}-${idx}-${rec.session_id}`,
              note: rec.note || topicName,
              date: rec.date || "",
              session_id: rec.session_id,
              default_media_type: rec.default_media_type,
            }));
          if (recordings.length > 0) {
            recordingIndex.set(`${norm(examName)}||${norm(subjectName)}||${norm(topicName)}`, recordings);
          }
        });
      });
    });

    exams.forEach((exam) => {
      const examName = exam?.exam || "General";
      (exam?.tests || []).forEach((sourceBlock) => {
        const sourceName = sourceBlock?.source || "General";
        if (!bySource.has(sourceName)) bySource.set(sourceName, []);

        (sourceBlock?.tests || []).forEach((test) => {
          const testNumber = String(test?.test_number || "").trim();
          const testName = String(test?.test_name || "").trim();
          const dedupeKey = `${norm(examName)}||${norm(sourceName)}||${norm(testNumber)}||${norm(testName)}`;
          const list = bySource.get(sourceName);
          if (list.some((row) => row._dedupeKey === dedupeKey)) return;

          const directRecordings = Array.isArray(test?.recordings)
            ? test.recordings
                .filter((rec) => rec?.session_id && rec?.default_media_type)
                .map((rec, idx) => ({
                  key: `test-row-rec-${norm(examName)}-${norm(sourceName)}-${norm(testNumber)}-${idx}-${rec.session_id}`,
                  note: rec.note || testName || `Test ${testNumber}`,
                  date: rec.date || "",
                  session_id: rec.session_id,
                  default_media_type: rec.default_media_type,
                }))
            : [];

          let linkedRecordings = directRecordings;
          if (linkedRecordings.length === 0) {
            const candidates = [testName, `Test ${testNumber}`, testNumber].filter((v) => v && v.trim());
            for (const candidate of candidates) {
              const hit = recordingIndex.get(`${norm(examName)}||${norm(sourceName)}||${norm(candidate)}`);
              if (hit?.length) {
                linkedRecordings = hit;
                break;
              }
            }
          }

          list.push({
            _dedupeKey: dedupeKey,
            exam: examName,
            test_name: testName,
            test_number: testNumber,
            note: test?.note || "",
            test_given_date: test?.test_given_date || "",
            analysis_done_date: test?.analysis_done_date || "",
            revision_date: test?.revision_date || "",
            second_revision_date: test?.second_revision_date || "",
            recordings: linkedRecordings,
          });
        });
      });
    });

    return Array.from(bySource.entries())
      .map(([source, tests]) => ({
        source,
        tests: tests
          .slice()
          .sort((a, b) => {
            const aNum = Number(a.test_number);
            const bNum = Number(b.test_number);
            if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
            return String(a.test_number).localeCompare(String(b.test_number));
          }),
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
  }, [syllabus]);

  const playRecording = async (rec) => {
    if (!API_BASE_URL || !rec.session_id || !rec.default_media_type) return;
    setPlaybackLoadingKey(rec.key);
    setError("");
    try {
      const res = await apiFetch(
        `${API_BASE_URL}/sessions/${encodeURIComponent(rec.session_id)}/playback-url?media_type=${encodeURIComponent(rec.default_media_type)}`
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Playback API failed: ${res.status} ${txt}`);
      }
      const json = await res.json();
      setPlaybackByKey((prev) => ({
        ...prev,
        [rec.key]: {
          url: json.playback_url || "",
          mediaType: rec.default_media_type,
        },
      }));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setPlaybackLoadingKey("");
    }
  };

  return (
    <main className="app-shell mission-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero mission-hero">
        <MainMenu active="syllabus" />
        <h1>Progress Hub</h1>
        <p className="subtext">Your growth dashboard — achievements, consistency, weak areas, and what to fix next.</p>

        {!API_BASE_URL ? <p className="api-state warn">Backend URL needed for live data. Showing sample data below.</p> : null}
        {error ? <p className="api-state error">{error}</p> : null}
      </header>

      <section className="milestone-panel mission-controls">
        <div className="session-form-grid">
          <button className="btn-day" onClick={() => loadProgress()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Progress"}
          </button>
        </div>
        {usingDummy ? <p className="api-state warn" style={{ marginTop: 10 }}>{DUMMY_DATA_NOTICE}</p> : null}
      </section>

      <HubTabs tabs={HUB_TABS} active={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" ? (
        <div role="tabpanel" aria-label="Overview" className="hub-grid">
          <GoalHealthHero mission={mission} streaks={streaks} weekPulse={weekPulse} />
          <div className="hub-span-2">
            <CoachNote mission={mission} />
          </div>
          <WeekPulse weekPulse={weekPulse} />
          <div className="hub-span-2">
            <ContributionCalendar activityByDate={activityByDate} streaks={streaks} />
          </div>
          <div className="hub-span-2">
            <FocusBalance mission={mission} />
          </div>
          <NeedsAttention mission={mission} />
          <div className="hub-span-3">
            <Achievements mission={mission} streaks={streaks} />
          </div>
        </div>
      ) : null}

      {activeTab === "tests" ? (
        <div role="tabpanel" aria-label="Tests">
          <TestStoryPanel mission={mission} />
        </div>
      ) : null}

      {activeTab === "detail" ? (
        <div role="tabpanel" aria-label="Detail">
          <article className="milestone-panel">
            <h2>Progress by Area</h2>
            <p className="day-state">Coverage, retention, and performance for everything in your plan.</p>
            <DimensionProgressGrid dimensions={planExecution.dimensions || []} />
          </article>
          <article className="milestone-panel">
            <h2>Syllabus Detail</h2>
            <p className="day-state">Expand to see class dates, revisions, notes, and recordings.</p>
            <SyllabusTree
              data={syllabus}
              globalTestsBySource={globalTestsBySource}
              playbackByKey={playbackByKey}
              playbackLoadingKey={playbackLoadingKey}
              onPlay={playRecording}
            />
          </article>
        </div>
      ) : null}
    </main>
  );
}
