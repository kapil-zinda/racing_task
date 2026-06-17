"use client";
import { apiFetch } from "../lib/auth";

import { useEffect, useMemo, useState } from "react";
import MainMenu from "../components/MainMenu";
import { buildDummyActivity, buildDummyJourneys, DUMMY_DATA_NOTICE } from "../lib/dummyData";
import { buildStreaks } from "../lib/journeyInsights";
import JourneyHero from "../components/journey/JourneyHero";
import JourneyEmptyState from "../components/journey/JourneyEmptyState";
import CreateJourneyWizard from "../components/journey/CreateJourneyWizard";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;

const blankDraft = { title: "", target_date: "", plan: { structure: [] } };

export default function JourneyPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [journeys, setJourneys] = useState([]);
  const [activityByDate, setActivityByDate] = useState({});
  const [usingDummy, setUsingDummy] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [missionSaving, setMissionSaving] = useState(false);

  const applyDummyData = () => {
    setJourneys(buildDummyJourneys());
    setActivityByDate(buildDummyActivity());
    setUsingDummy(true);
  };

  const loadJourneys = async () => {
    if (!API_BASE_URL) {
      applyDummyData();
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [journeysRes, controlRes] = await Promise.all([
        apiFetch(`${API_BASE_URL}/journeys`),
        apiFetch(`${API_BASE_URL}/mission-control?lookback_days=90`),
      ]);
      if (!journeysRes.ok) {
        const txt = await journeysRes.text();
        throw new Error(`Journey API failed: ${journeysRes.status} ${txt}`);
      }
      const journeysPayload = await journeysRes.json();
      const controlPayload = controlRes.ok ? await controlRes.json() : {};
      setJourneys(journeysPayload?.journeys || []);
      setActivityByDate(controlPayload?.activity_by_date || {});
      setUsingDummy(false);
    } catch (err) {
      setError(String(err.message || err));
      applyDummyData();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJourneys();
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [error]);

  const streaks = useMemo(() => buildStreaks(activityByDate), [activityByDate]);

  const handleCreateJourney = async (draft) => {
    if (!API_BASE_URL) {
      const journey = {
        id: `local-${Date.now()}`,
        status: "active",
        icon: "🎯",
        ...draft,
      };
      setJourneys((prev) => [journey, ...prev]);
      setWizardOpen(false);
      return;
    }
    setMissionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/journeys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Journey create failed: ${res.status} ${txt}`);
      }
      await loadJourneys();
      setWizardOpen(false);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setMissionSaving(false);
    }
  };

  const togglePauseJourney = async (journey) => {
    const nextStatus = (journey.status || "active").toLowerCase() === "paused" ? "active" : "paused";
    if (!API_BASE_URL) {
      setJourneys((prev) => prev.map((j) => (j.id === journey.id ? { ...j, status: nextStatus } : j)));
      return;
    }
    setMissionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/journeys/${journey.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Journey update failed: ${res.status} ${txt}`);
      }
      await loadJourneys();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setMissionSaving(false);
    }
  };

  const deleteJourney = async (journey) => {
    if (!window.confirm("Delete this journey? This cannot be undone.")) return;
    if (!API_BASE_URL) {
      setJourneys((prev) => prev.filter((j) => j.id !== journey.id));
      return;
    }
    setMissionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/journeys/${journey.id}`, { method: "DELETE" });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Journey delete failed: ${res.status} ${txt}`);
      }
      await loadJourneys();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setMissionSaving(false);
    }
  };

  const hasAreas = journeys.length > 0;

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
          <button className="btn-day" onClick={() => loadJourneys()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Journey"}
          </button>
          <button className="btn-day secondary" onClick={() => setWizardOpen(true)} disabled={loading}>
            Create New Journey
          </button>
        </div>
        {usingDummy ? (
          <p className="api-state warn" style={{ marginTop: 10 }}>
            {DUMMY_DATA_NOTICE}
          </p>
        ) : null}
      </section>

      {!hasAreas ? (
        <JourneyEmptyState onCreate={() => setWizardOpen(true)} />
      ) : (
        <>
          <p className="journey-streak-banner">🔥 {streaks?.current || 0}-day streak</p>
          <div className="journey-list">
            {journeys.map((journey) => (
              <JourneyHero
                key={journey.id}
                journey={journey}
                onTogglePause={() => togglePauseJourney(journey)}
                onDelete={() => deleteJourney(journey)}
                busy={missionSaving}
              />
            ))}
          </div>
        </>
      )}

      <CreateJourneyWizard
        open={wizardOpen}
        initialDraft={blankDraft}
        onSave={handleCreateJourney}
        onClose={() => setWizardOpen(false)}
        saving={missionSaving}
      />
    </main>
  );
}
