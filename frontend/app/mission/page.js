"use client";
import { apiFetch } from "../lib/auth";

import { useEffect, useMemo, useState } from "react";
import MainMenu from "../components/MainMenu";
import { buildMissionExecution, buildMissionModel } from "../lib/missionModel";
import { buildDummyMissionControl, DUMMY_DATA_NOTICE } from "../lib/dummyData";
import { buildStreaks } from "../lib/journeyInsights";
import JourneyHero from "../components/journey/JourneyHero";
import TodayMove from "../components/journey/TodayMove";
import JourneyTrail from "../components/journey/JourneyTrail";
import MilestoneDetailSheet from "../components/journey/MilestoneDetailSheet";
import JourneyEmptyState from "../components/journey/JourneyEmptyState";
import JourneyWizard from "../components/journey/JourneyWizard";

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

export default function JourneyPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syllabus, setSyllabus] = useState({ exams: [] });
  const [activityByDate, setActivityByDate] = useState({});
  const [missionConfig, setMissionConfig] = useState(null);
  const [usingDummy, setUsingDummy] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [missionSaving, setMissionSaving] = useState(false);
  const [selectedDim, setSelectedDim] = useState(null);
  const [battleDone, setBattleDone] = useState([false, false, false]);

  const applyDummyData = () => {
    const dummy = buildDummyMissionControl();
    setSyllabus(dummy.syllabus);
    setActivityByDate(dummy.activity_by_date);
    setMissionConfig(dummy.mission);
    setUsingDummy(true);
    setBattleDone([false, false, false]);
  };

  const loadMission = async () => {
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
        throw new Error(`Journey API failed: ${res.status} ${txt}`);
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
      setBattleDone([false, false, false]);
    } catch (err) {
      setError(String(err.message || err));
      applyDummyData();
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

  const planExecution = useMemo(
    () => buildMissionExecution(missionConfig?.plan, syllabus),
    [missionConfig?.plan, syllabus],
  );
  const mission = useMemo(() => buildMissionModel(planExecution), [planExecution]);
  const streaks = useMemo(() => buildStreaks(activityByDate), [activityByDate]);

  const initialDraft = useMemo(
    () => ({
      title: missionConfig?.title || "",
      target_date: missionConfig?.target_date || "",
      status: missionConfig?.status || "active",
      icon: missionConfig?.icon || "🎯",
      category: missionConfig?.category || "General",
      plan: {
        courses: Array.isArray(missionConfig?.plan?.courses) ? missionConfig.plan.courses : [],
        books: Array.isArray(missionConfig?.plan?.books) ? missionConfig.plan.books : [],
        random: Array.isArray(missionConfig?.plan?.random) ? missionConfig.plan.random : [],
        tests: sanitizeMissionTestRows(missionConfig?.plan?.tests),
      },
    }),
    [missionConfig],
  );

  const saveMission = async (draft) => {
    if (!API_BASE_URL) {
      setMissionConfig((prev) => ({ ...(prev || {}), ...draft }));
      setWizardOpen(false);
      return;
    }
    setMissionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/mission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          target_date: draft.target_date,
          status: draft.status,
          icon: draft.icon,
          category: draft.category,
          plan: {
            ...draft.plan,
            tests: sanitizeMissionTestRows(draft?.plan?.tests),
          },
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Journey save failed: ${res.status} ${txt}`);
      }
      const payload = await res.json();
      setMissionConfig(payload?.mission || null);
      setWizardOpen(false);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setMissionSaving(false);
    }
  };

  const dimensions = planExecution.dimensions || [];
  const hasAreas = dimensions.length > 0;

  return (
    <main className="app-shell mission-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero mission-hero">
        <MainMenu active="mission" />
        <h1>Journey</h1>
        <p className="subtext">Where you are, where you&apos;re going, and what to do next.</p>

        {!API_BASE_URL ? <p className="api-state warn">Backend URL needed for live data. Showing sample data below.</p> : null}
        {error ? <p className="api-state error">{error}</p> : null}
      </header>

      <section className="milestone-panel mission-controls">
        <div className="session-form-grid">
          <button className="btn-day" onClick={() => loadMission()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Journey"}
          </button>
          <button className="btn-day secondary" onClick={() => setWizardOpen(true)} disabled={loading}>
            Edit Journey
          </button>
        </div>
        {usingDummy ? (
          <p className="api-state warn" style={{ marginTop: 10 }}>
            {DUMMY_DATA_NOTICE}
          </p>
        ) : null}
      </section>

      {!hasAreas && !usingDummy ? (
        <JourneyEmptyState onCreate={() => setWizardOpen(true)} />
      ) : (
        <>
          <JourneyHero missionConfig={missionConfig} mission={mission} streaks={streaks} />

          <TodayMove
            mission={mission}
            battleDone={battleDone}
            onToggle={(idx) => setBattleDone((prev) => prev.map((v, i) => (i === idx ? !v : v)))}
          />

          <JourneyTrail dimensions={dimensions} onSelectMilestone={setSelectedDim} />
        </>
      )}

      <MilestoneDetailSheet dim={selectedDim} planExecution={planExecution} onClose={() => setSelectedDim(null)} />

      <JourneyWizard
        open={wizardOpen}
        initialDraft={initialDraft}
        onSave={saveMission}
        onClose={() => setWizardOpen(false)}
        saving={missionSaving}
      />
    </main>
  );
}
