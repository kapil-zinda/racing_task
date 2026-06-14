"use client";
import { apiFetch } from "../../lib/auth";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import MainMenu from "../../components/MainMenu";
import { buildDummyJourneys, DUMMY_DATA_NOTICE } from "../../lib/dummyData";
import JourneyActionsMenu from "../../components/journey/JourneyActionsMenu";
import JourneyTreeNode from "../../components/journey/JourneyTreeNode";
import JourneyNodeDialog from "../../components/journey/JourneyNodeDialog";
import {
  ensureNodeIds,
  createTreeNode,
  addChildToTree,
  deleteNodeFromTree,
  updateNodeInTree,
  countAllNodes,
  ROOT_PARENT_ID,
} from "../../components/journey/journeyTreeOps";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

export default function JourneyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const journeyId = params?.journeyId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [journey, setJourney] = useState(null);
  const [usingDummy, setUsingDummy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [missionSaving, setMissionSaving] = useState(false);
  const [dialog, setDialog] = useState(null);

  const loadJourney = async () => {
    setLoading(true);
    setError("");
    if (!API_BASE_URL) {
      const dummy = buildDummyJourneys().find((j) => j.id === journeyId) || buildDummyJourneys()[0];
      setJourney({ ...dummy, plan: { structure: ensureNodeIds(dummy?.plan?.structure || []) } });
      setUsingDummy(true);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE_URL}/journeys`);
      if (!res.ok) throw new Error(`Journey API failed: ${res.status} ${await res.text()}`);
      const payload = await res.json();
      const found = (payload?.journeys || []).find((j) => j.id === journeyId);
      if (!found) throw new Error("Journey not found");
      setJourney({ ...found, plan: { structure: ensureNodeIds(found?.plan?.structure || []) } });
      setUsingDummy(false);
    } catch (err) {
      setError(String(err.message || err));
      setJourney(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJourney();
  }, [journeyId]);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), 15000);
    return () => clearTimeout(id);
  }, [error]);

  const persistStructure = async (nextStructure, prevStructure) => {
    setJourney((prev) => (prev ? { ...prev, plan: { structure: nextStructure } } : prev));
    if (!API_BASE_URL) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/journeys/${journeyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: { structure: nextStructure } }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status} ${await res.text()}`);
      const updated = await res.json();
      setJourney((prev) => (prev ? { ...prev, plan: { structure: ensureNodeIds(updated?.plan?.structure || []) } } : prev));
    } catch (err) {
      setError(String(err.message || err));
      setJourney((prev) => (prev ? { ...prev, plan: { structure: prevStructure } } : prev));
    } finally {
      setSaving(false);
    }
  };

  const handleRenameNode = (nodeId, newLabel) => {
    const prev = journey.plan.structure;
    const next = updateNodeInTree(prev, nodeId, (n) => ({ ...n, label: newLabel.trim() }));
    persistStructure(next, prev);
  };

  const handleDeleteNode = (node) => {
    const descendantCount = countAllNodes(node.children || []);
    const msg = descendantCount > 0
      ? `Delete "${node.label}" and all ${descendantCount} sub-node${descendantCount === 1 ? "" : "s"}? This cannot be undone.`
      : `Delete "${node.label}"? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    const prev = journey.plan.structure;
    const next = deleteNodeFromTree(prev, node.id);
    persistStructure(next, prev);
  };

  const handleAddChild = (parentId, label) => {
    const prev = journey.plan.structure;
    const childNode = createTreeNode(label);
    const next = addChildToTree(prev, parentId, childNode);
    persistStructure(next, prev);
  };

  const handleSetCounters = (nodeId, newCounters) => {
    const prev = journey.plan.structure;
    const next = updateNodeInTree(prev, nodeId, (n) => ({ ...n, counters: newCounters }));
    persistStructure(next, prev);
  };

  const handleTogglePause = async () => {
    const nextStatus = (journey.status || "active").toLowerCase() === "paused" ? "active" : "paused";
    if (!API_BASE_URL) {
      setJourney((prev) => ({ ...prev, status: nextStatus }));
      return;
    }
    setMissionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/journeys/${journeyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error(`Journey update failed: ${res.status} ${await res.text()}`);
      setJourney((prev) => ({ ...prev, status: nextStatus }));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setMissionSaving(false);
    }
  };

  const handleDeleteJourney = async () => {
    if (!window.confirm("Delete this journey? This cannot be undone.")) return;
    if (!API_BASE_URL) {
      router.push("/mission");
      return;
    }
    setMissionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/journeys/${journeyId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Journey delete failed: ${res.status} ${await res.text()}`);
      router.push("/mission");
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setMissionSaving(false);
    }
  };

  const structure = journey?.plan?.structure || [];

  return (
    <main className="app-shell mission-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero mission-hero">
        <MainMenu active="mission" />
        <button type="button" className="btn-day secondary journey-back-link" onClick={() => router.push("/mission")}>
          ← Back to Journeys
        </button>
        {!API_BASE_URL ? <p className="api-state warn">Backend URL needed for live data. Showing sample data below.</p> : null}
        {error ? <p className="api-state error">{error}</p> : null}
      </header>

      {loading ? (
        <p className="day-state">Loading...</p>
      ) : journey ? (
        <>
          <section className="journey-hero-card journey-detail-header">
            <JourneyActionsMenu status={journey.status} onTogglePause={handleTogglePause} onDelete={handleDeleteJourney} busy={missionSaving} />
            <div className="journey-hero-icon" aria-hidden="true">{journey.icon || "🎯"}</div>
            <div className="journey-hero-body">
              <p className="journey-hero-eyebrow">
                {journey.icon} {journey.title}
              </p>
            </div>
          </section>
          {usingDummy ? <p className="api-state warn" style={{ marginTop: 10 }}>{DUMMY_DATA_NOTICE}</p> : null}

          <section className="journey-tree-section">
            <div className="journey-tree-toolbar">
              <h2>Tree view</h2>
              <button type="button" className="btn-day" onClick={() => setDialog({ mode: "addChild", nodeId: ROOT_PARENT_ID })}>
                + Add top-level node
              </button>
            </div>

            <div className="journey-org-chart-wrap">
              <ul className="org-chart org-chart-root">
                <li>
                  <div className="org-node org-node-root">
                    <span className="org-node-icon" aria-hidden="true">{journey.icon || "🎯"}</span>
                    <span className="org-node-label">{journey.title}</span>
                  </div>
                  {structure.length === 0 ? (
                    <div className="area-empty">No nodes yet — add your first top-level node to start building this journey&apos;s tree.</div>
                  ) : (
                    <ul>
                      {structure.map((node) => (
                        <JourneyTreeNode
                          key={node.id}
                          node={node}
                          ancestors={[]}
                          onRename={(id, label) => setDialog({ mode: "rename", nodeId: id, initialValue: label })}
                          onDelete={handleDeleteNode}
                          onAddChild={(id) => setDialog({ mode: "addChild", nodeId: id })}
                          onManageCounters={(id) => setDialog({ mode: "counters", nodeId: id })}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              </ul>
            </div>
          </section>
        </>
      ) : (
        <p className="day-state">Journey not found.</p>
      )}

      <JourneyNodeDialog
        dialog={dialog}
        tree={structure}
        onClose={() => setDialog(null)}
        onRename={(id, label) => {
          handleRenameNode(id, label);
          setDialog(null);
        }}
        onAddChild={(parentId, label) => {
          handleAddChild(parentId, label);
          setDialog(null);
        }}
        onSaveCounters={(id, counters) => {
          handleSetCounters(id, counters);
          setDialog(null);
        }}
        saving={saving}
      />
    </main>
  );
}
