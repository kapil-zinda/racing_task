"use client";
// Dependency graph: nodes laid out by depth, edges from goal_dependencies. Click two
// nodes (source then target) with "link mode" on to create a dependency.

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls } from "reactflow";
import "reactflow/dist/style.css";
import { listDependencies, createDependency, deleteDependency } from "../../lib/goalApi";
import { confirmDialog } from "../../lib/dialog";
import { friendlyApiError } from "../../lib/errors";

export default function DependencyGraph({ goalId, nodes }) {
  const [deps, setDeps] = useState([]);
  const [linkFrom, setLinkFrom] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try { const d = await listDependencies(goalId); setDeps(d.dependencies || []); }
    catch (e) { setErr(friendlyApiError(e)); }
  }, [goalId]);
  useEffect(() => { load(); }, [load]);

  const flowNodes = useMemo(() => {
    // Simple layered layout: x by depth, y by order within depth.
    const perDepth = {};
    return nodes.map((n) => {
      const d = n.depth || 0;
      perDepth[d] = (perDepth[d] || 0) + 1;
      return {
        id: n.id,
        position: { x: d * 220, y: (perDepth[d] - 1) * 70 },
        data: { label: `${n.title} (${Math.round(n.progress || 0)}%)` },
        style: {
          background: linkFrom === n.id ? "var(--indigo)" : "var(--card)",
          color: "var(--text)", border: "1px solid var(--border-strong)", borderRadius: 10, fontSize: 12, width: 180,
        },
      };
    });
  }, [nodes, linkFrom]);

  const flowEdges = useMemo(() => deps.map((d) => ({
    id: d.id, source: d.source_node_id, target: d.target_node_id, animated: true,
    style: { stroke: "#8b5cf6" }, label: d.dependency_type,
  })), [deps]);

  const onNodeClick = async (_e, node) => {
    if (!linkFrom) { setLinkFrom(node.id); return; }
    if (linkFrom === node.id) { setLinkFrom(null); return; }
    try {
      await createDependency({ goal_id: goalId, source_node_id: linkFrom, target_node_id: node.id });
      setLinkFrom(null); load();
    } catch (e) { setErr(friendlyApiError(e)); setLinkFrom(null); }
  };

  const onEdgeClick = async (_e, edge) => {
    if (await confirmDialog({ message: "Delete this dependency?", confirmLabel: "Delete", danger: true })) {
      try { await deleteDependency(edge.id); load(); } catch (e) { setErr(friendlyApiError(e)); }
    }
  };

  return (
    <div className="dep-graph-wrap">
      <div className="dep-graph-toolbar">
        <span className="goal-hint">
          {linkFrom ? "Now click the node it depends on…" : "Click a node, then another, to link a dependency. Click an edge to delete."}
        </span>
        {linkFrom && <button className="goal-btn ghost tiny" onClick={() => setLinkFrom(null)}>Cancel link</button>}
      </div>
      {err && <div className="goal-error">{err}</div>}
      <div className="dep-graph">
        <ReactFlow nodes={flowNodes} edges={flowEdges} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick}
                   fitView proOptions={{ hideAttribution: true }}>
          <Background color="var(--card-border)" />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
