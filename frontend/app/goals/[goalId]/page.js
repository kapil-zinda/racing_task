"use client";
// Goal detail — split layout: left = drag-drop tree editor, right = node detail.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import MainMenu from "../../components/MainMenu";
import GoalTree from "../../components/goal/GoalTree";
import NodeDetail from "../../components/goal/NodeDetail";
import BulkAddChildren from "../../components/goal/BulkAddChildren";
import GoalInsights from "../../components/goal/GoalInsights";
import DependencyGraph from "../../components/goal/DependencyGraph";
import {
  getGoal, getTree, getActivity, buildTree,
  createNode, updateNode, deleteNode, moveNode,
} from "../../lib/goalApi";

export default function GoalDetailPage() {
  const { goalId } = useParams();
  const [goal, setGoal] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [activity, setActivity] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bulkFor, setBulkFor] = useState(undefined); // undefined=closed, null=top-level, node=under node
  const [view, setView] = useState("tree"); // "tree" | "graph"

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [g, tree, act] = await Promise.all([
        getGoal(goalId), getTree(goalId), getActivity(goalId, 200),
      ]);
      setGoal(g);
      setNodes(tree.nodes || []);
      setActivity(act.activity || []);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useEffect(() => { load(); }, [load]);

  const roots = useMemo(() => buildTree(nodes), [nodes]);
  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) || null, [nodes, selectedId]);

  // Refresh only the tree + activity (after a mutation) without full-page spinner.
  const refresh = useCallback(async () => {
    try {
      const [g, tree, act] = await Promise.all([
        getGoal(goalId), getTree(goalId), getActivity(goalId, 200),
      ]);
      setGoal(g); setNodes(tree.nodes || []); setActivity(act.activity || []);
    } catch (err) { setError(String(err.message || err)); }
  }, [goalId]);

  const handleAddChild = async (parentId) => {
    const title = window.prompt("New node title:");
    if (!title || !title.trim()) return;
    try {
      const created = await createNode({ goal_id: goalId, parent_id: parentId, title: title.trim() });
      await refresh();
      setSelectedId(created.id);
    } catch (err) { setError(String(err.message || err)); }
  };

  const handleAddRoot = async () => {
    const title = window.prompt("New top-level node title:");
    if (!title || !title.trim()) return;
    try {
      const created = await createNode({ goal_id: goalId, title: title.trim() });
      await refresh();
      setSelectedId(created.id);
    } catch (err) { setError(String(err.message || err)); }
  };

  const handleUpdate = async (nodeId, patch) => {
    await updateNode(nodeId, patch);
    await refresh();
  };

  const handleDelete = async (node) => {
    if (!window.confirm(`Delete "${node.title}" and all its children?`)) return;
    try {
      await deleteNode(node.id);
      if (selectedId === node.id) setSelectedId(null);
      await refresh();
    } catch (err) { setError(String(err.message || err)); }
  };

  const handleMove = async (nodeId, newParentId) => {
    try { await moveNode(nodeId, { new_parent_id: newParentId }); await refresh(); }
    catch (err) { setError(String(err.message || err)); }
  };

  return (
    <div className="goal-page">
      <MainMenu active="goals" />
      <div className="goal-detail-container">
        <header className="goal-detail-head">
          <div className="goal-detail-title">
            <Link href="/goals" className="goal-back">← Goals</Link>
            {goal && (
              <div className="goal-detail-name">
                <span className="goal-card-icon">{goal.icon || "🎯"}</span>
                <h1>{goal.name}</h1>
                <span className="node-progress-badge lg">{Math.round(goal.progress || 0)}%</span>
              </div>
            )}
          </div>
          <button className="goal-btn ghost" onClick={load} title="Refresh">↻ Refresh</button>
        </header>

        {error && <div className="goal-error">{error}</div>}

        {loading ? (
          <div className="goal-empty">Loading…</div>
        ) : (
          <div className="goal-split">
            <div className="goal-split-left">
              <div className="goal-view-toggle">
                <button className={view === "tree" ? "active" : ""} onClick={() => setView("tree")}>🌳 Tree</button>
                <button className={view === "graph" ? "active" : ""} onClick={() => setView("graph")}>🔗 Dependencies</button>
              </div>
              {view === "tree" ? (
                <GoalTree roots={roots} selectedId={selectedId} onSelect={setSelectedId}
                          onAddChild={handleAddChild} onAddRoot={handleAddRoot}
                          onBulkAdd={(node) => setBulkFor(node)}
                          onMove={handleMove} onDelete={handleDelete} />
              ) : (
                <DependencyGraph goalId={goalId} nodes={nodes} />
              )}
            </div>
            <div className="goal-split-right">
              {selected ? (
                <NodeDetail node={selected} activity={activity}
                            onUpdate={handleUpdate} onDelete={handleDelete} onChanged={refresh} />
              ) : (
                <GoalInsights goalId={goalId} onJump={setSelectedId} />
              )}
            </div>
          </div>
        )}
      </div>

      {bulkFor !== undefined && (
        <BulkAddChildren goalId={goalId} parent={bulkFor}
                         onClose={() => setBulkFor(undefined)}
                         onDone={refresh} />
      )}
    </div>
  );
}
