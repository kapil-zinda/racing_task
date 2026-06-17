"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/auth";
import { buildDummyJourneys, DUMMY_DATA_NOTICE } from "../../lib/dummyData";
import JourneyHero from "../journey/JourneyHero";
import JourneyTreeNode from "../journey/JourneyTreeNode";
import { ensureNodeIds } from "../journey/journeyTreeOps";
import { progressKey, buildDoneSet } from "../journey/journeyProgress";

export default function ProgressUpdatesPanel({ apiBaseUrl }) {
  const liveMode = Boolean(apiBaseUrl);

  const [journeys, setJourneys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usingDummy, setUsingDummy] = useState(false);

  const [selected, setSelected] = useState(null); // selected journey object
  const [doneSet, setDoneSet] = useState(new Set());
  const [progressLoading, setProgressLoading] = useState(false);

  const applyDummy = () => {
    const dummy = buildDummyJourneys().map((j) => ({
      ...j,
      plan: { structure: ensureNodeIds(j?.plan?.structure || []) },
    }));
    setJourneys(dummy);
    setUsingDummy(true);
  };

  const loadJourneys = async () => {
    setLoading(true);
    setError("");
    if (!liveMode) {
      applyDummy();
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch(`${apiBaseUrl}/journeys`);
      if (!res.ok) throw new Error(`Journey API failed: ${res.status} ${await res.text()}`);
      const payload = await res.json();
      const list = (payload?.journeys || []).map((j) => ({
        ...j,
        plan: { structure: ensureNodeIds(j?.plan?.structure || []) },
      }));
      setJourneys(list);
      setUsingDummy(false);
    } catch (err) {
      setError(String(err.message || err));
      applyDummy();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJourneys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!error) return undefined;
    const id = setTimeout(() => setError(""), 15000);
    return () => clearTimeout(id);
  }, [error]);

  const openJourney = async (journey) => {
    setSelected(journey);
    setDoneSet(new Set());
    if (!liveMode) return;
    setProgressLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${apiBaseUrl}/journeys/${journey.id}/progress`);
      if (!res.ok) throw new Error(`Progress API failed: ${res.status} ${await res.text()}`);
      const payload = await res.json();
      setDoneSet(buildDoneSet(payload?.completions));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setProgressLoading(false);
    }
  };

  const backToList = () => {
    setSelected(null);
    setDoneSet(new Set());
  };

  const handleToggleOccurrence = async (nodeId, nodeLabel, counterKey, occurrence, action) => {
    if (!selected) return;
    const key = progressKey(nodeId, counterKey, occurrence);
    const prev = doneSet;
    const next = new Set(prev);
    if (action === "done") next.add(key);
    else next.delete(key);
    setDoneSet(next);

    if (!liveMode) return;
    setError("");
    try {
      const res = await apiFetch(`${apiBaseUrl}/journeys/${selected.id}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_id: nodeId,
          node_label: nodeLabel,
          counter_key: counterKey,
          occurrence,
          action,
        }),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`);
      const payload = await res.json();
      setDoneSet(buildDoneSet(payload?.completions));
    } catch (err) {
      setError(String(err.message || err));
      setDoneSet(prev); // revert
    }
  };

  const structure = selected?.plan?.structure || [];

  return (
    <div role="tabpanel" aria-label="Updates" className="progress-updates-panel">
      {error ? <p className="api-state error">{error}</p> : null}

      {loading ? (
        <p className="day-state">Loading journeys…</p>
      ) : selected ? (
        <article className="milestone-panel">
          <div className="journey-tree-toolbar">
            <button type="button" className="btn-day secondary" onClick={backToList}>
              ← Back to journeys
            </button>
            {progressLoading ? <span className="day-state">Loading progress…</span> : null}
          </div>

          <div className="journey-org-chart-wrap">
            <ul className="org-chart org-chart-root">
              <li>
                <div className="org-node org-node-root">
                  <span className="org-node-icon" aria-hidden="true">{selected.icon || "🎯"}</span>
                  <span className="org-node-label">{selected.title}</span>
                </div>
                {structure.length === 0 ? (
                  <div className="area-empty">This journey has no nodes yet.</div>
                ) : (
                  <ul>
                    {structure.map((node) => (
                      <JourneyTreeNode
                        key={node.id}
                        node={node}
                        ancestors={[]}
                        variant="progress"
                        doneSet={doneSet}
                        onToggleOccurrence={handleToggleOccurrence}
                      />
                    ))}
                  </ul>
                )}
              </li>
            </ul>
          </div>
        </article>
      ) : (
        <article className="milestone-panel">
          <h2>Update Progress</h2>
          <p className="day-state">Pick a journey to open its tree and mark study, revision, and test occurrences as done.</p>
          {usingDummy ? <p className="api-state warn" style={{ marginTop: 10 }}>{DUMMY_DATA_NOTICE}</p> : null}
          {journeys.length === 0 ? (
            <div className="area-empty">No journeys yet. Create one from the Journeys page to start tracking progress.</div>
          ) : (
            <div className="journey-list">
              {journeys.map((journey) => (
                <JourneyHero key={journey.id} journey={journey} onOpen={openJourney} showActions={false} />
              ))}
            </div>
          )}
        </article>
      )}
    </div>
  );
}
