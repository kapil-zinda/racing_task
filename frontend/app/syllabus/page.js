"use client";
import { apiFetch } from "../lib/auth";

import { useEffect, useMemo, useState } from "react";
import MainMenu from "../components/MainMenu";
import { buildMissionExecution, buildMissionModel } from "../lib/missionModel";
import { buildDummyMissionControl, DUMMY_DATA_NOTICE } from "../lib/dummyData";
import { buildStreaks, buildWeekPulse, buildDailyLeafNodeSeries, buildJourneyActivityByDate, buildJourneyDailySeries, buildJourneyAttentionNodes } from "../lib/journeyInsights";
import HubTabs from "../components/progress-hub/HubTabs";
import JourneyTrail from "../components/journey/JourneyTrail";
import DailyUpdatesChart from "../components/progress-hub/DailyUpdatesChart";
import GoalHealthHero from "../components/progress-hub/GoalHealthHero";
import WeekPulse from "../components/progress-hub/WeekPulse";
import ContributionCalendar from "../components/progress-hub/ContributionCalendar";
import FocusBalance from "../components/progress-hub/FocusBalance";
import NeedsAttention from "../components/progress-hub/NeedsAttention";
import CoachNote from "../components/progress-hub/CoachNote";
import Achievements from "../components/progress-hub/Achievements";
import ProgressUpdatesPanel from "../components/progress-hub/ProgressUpdatesPanel";
import DimensionProgressGrid from "../components/progress-hub/DimensionProgressGrid";
import JourneyDetailTable from "../components/progress-hub/JourneyDetailTable";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;

const HUB_TABS = [
  { key: "overview", label: "Overview", icon: "📊" },
  { key: "updates", label: "Updates", icon: "✅" },
  { key: "detail", label: "Detail", icon: "📚" },
];

export default function ProgressHubPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syllabus, setSyllabus] = useState({ exams: [] });
  const [activityByDate, setActivityByDate] = useState({});
  const [missionConfig, setMissionConfig] = useState(null);
  const [usingDummy, setUsingDummy] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [journeys, setJourneys] = useState([]);
  const [progressByJourney, setProgressByJourney] = useState({});

  const applyDummyData = () => {
    const dummy = buildDummyMissionControl();
    setSyllabus(dummy.syllabus);
    setActivityByDate(dummy.activity_by_date);
    setMissionConfig(dummy.mission);
    setJourneys([]);
    setProgressByJourney({});
    setUsingDummy(true);
  };

  const loadJourneys = async () => {
    if (!API_BASE_URL) {
      setJourneys([]);
      setProgressByJourney({});
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE_URL}/journeys`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Journey API failed: ${res.status} ${txt}`);
      }
      const payload = await res.json();
      const list = Array.isArray(payload?.journeys) ? payload.journeys : [];
      setJourneys(list);

      const entries = await Promise.all(
        list.map(async (journey) => {
          try {
            const pRes = await apiFetch(`${API_BASE_URL}/journeys/${encodeURIComponent(journey.id)}/progress`);
            if (!pRes.ok) return [journey.id, []];
            const pPayload = await pRes.json();
            return [journey.id, pPayload?.completions || []];
          } catch {
            return [journey.id, []];
          }
        }),
      );
      setProgressByJourney(Object.fromEntries(entries));
    } catch (err) {
      setError(String(err.message || err));
      setJourneys([]);
      setProgressByJourney({});
    }
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
      await loadJourneys();
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

  const journeyActivityByDate = useMemo(
    () => buildJourneyActivityByDate(journeys, progressByJourney),
    [journeys, progressByJourney],
  );
  const mergedActivityByDate = useMemo(() => {
    const merged = { ...activityByDate };
    Object.entries(journeyActivityByDate).forEach(([date, counts]) => {
      merged[date] = { ...(merged[date] || {}), ...counts };
    });
    return merged;
  }, [activityByDate, journeyActivityByDate]);

  const streaks = useMemo(() => buildStreaks(mergedActivityByDate), [mergedActivityByDate]);
  const weekPulse = useMemo(() => buildWeekPulse(mergedActivityByDate), [mergedActivityByDate]);
  const journeyDailySeries = useMemo(
    () => buildJourneyDailySeries(journeys, progressByJourney),
    [journeys, progressByJourney],
  );
  const attentionNodes = useMemo(
    () => buildJourneyAttentionNodes(journeys, progressByJourney),
    [journeys, progressByJourney],
  );

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
          {/* <GoalHealthHero mission={mission} streaks={streaks} weekPulse={weekPulse} /> */}
          <div className="hub-span-2">
            <CoachNote mission={mission} />
          </div>
          <WeekPulse weekPulse={weekPulse} />
          <div className="hub-span-2">
            <DailyUpdatesChart series={journeyDailySeries} />
          </div>
          <NeedsAttention attentionNodes={attentionNodes} />
          <div className="hub-span-3">
            <ContributionCalendar activityByDate={mergedActivityByDate} streaks={streaks} />
          </div>
          <div className="hub-span-3">
            <JourneyTrail dimensions={planExecution.dimensions || []} />
          </div>
          {/* <div className="hub-span-2">
            <FocusBalance mission={mission} />
          </div> */}
          {/* <div className="hub-span-3">
            <Achievements mission={mission} streaks={streaks} />
          </div> */}
        </div>
      ) : null}

      {activeTab === "updates" ? (
        <ProgressUpdatesPanel apiBaseUrl={API_BASE_URL} />
      ) : null}

      {activeTab === "detail" ? (
        <div role="tabpanel" aria-label="Detail">
          <article className="milestone-panel">
            <h2>Progress by Area</h2>
            <p className="day-state">Coverage, retention, and performance for everything in your plan.</p>
            <DimensionProgressGrid dimensions={planExecution.dimensions || []} />
          </article>
          <article className="milestone-panel">
            <h2>Journeys</h2>
            <p className="day-state">Each task with its directory, progress, and first/last completion dates.</p>
            <JourneyDetailTable journeys={journeys} progressByJourney={progressByJourney} />
          </article>
        </div>
      ) : null}
    </main>
  );
}
