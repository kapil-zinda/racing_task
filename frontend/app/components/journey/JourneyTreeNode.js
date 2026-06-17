"use client";

import { useState } from "react";
import JourneyNodeMenu from "./JourneyNodeMenu";
import JourneyProgressMenu from "./JourneyProgressMenu";
import { getEffectiveCounters } from "./journeyTreeOps";
import { leafProgress } from "./journeyProgress";

export default function JourneyTreeNode({
  node,
  ancestors,
  onRename,
  onDelete,
  onAddChild,
  onManageCounters,
  variant = "edit",
  doneSet,
  onToggleOccurrence,
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const effectiveCounters = getEffectiveCounters(node, ancestors);
  const nextAncestors = [...(ancestors || []), node];
  const isProgress = variant === "progress";
  const isLeaf = !hasChildren;
  const showProgressMenu = isProgress && isLeaf && effectiveCounters.length > 0;
  const progress = showProgressMenu ? leafProgress(node.id, effectiveCounters, doneSet) : null;

  return (
    <li className={hasChildren && !expanded ? "org-node-collapsed" : ""}>
      <div className="org-node">
        {hasChildren ? (
          <button
            type="button"
            className="org-node-toggle"
            aria-label={expanded ? "Collapse sub-nodes" : "Expand sub-nodes"}
            title={expanded ? "Collapse sub-nodes" : "Expand sub-nodes"}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : null}
        <span className="org-node-label">{node.label}</span>
        {progress ? (
          <span
            className={`org-node-progress-badge ${progress.completed > 0 ? "has-progress" : ""}`}
            title={`${progress.completed} of ${progress.total} completed`}
          >
            {progress.completed}/{progress.total} · {progress.pct}%
          </span>
        ) : null}
        {isProgress ? (
          showProgressMenu ? (
            <JourneyProgressMenu
              nodeId={node.id}
              nodeLabel={node.label}
              effectiveCounters={effectiveCounters}
              doneSet={doneSet}
              onToggleOccurrence={onToggleOccurrence}
            />
          ) : null
        ) : (
          <JourneyNodeMenu
            onEdit={() => onRename(node.id, node.label)}
            onDelete={() => onDelete(node)}
            onAddChild={() => onAddChild(node.id)}
            onManageCounters={() => onManageCounters(node.id)}
          />
        )}
      </div>
      {!isProgress && isLeaf && effectiveCounters.length > 0 ? (
        <div className="org-node-counters">
          {effectiveCounters.map((c) => (
            <span className="org-node-counter-badge" key={c.key}>
              {c.key}: {c.count}
            </span>
          ))}
        </div>
      ) : null}
      {hasChildren && expanded ? (
        <ul>
          {node.children.map((child) => (
            <JourneyTreeNode
              key={child.id}
              node={child}
              ancestors={nextAncestors}
              onRename={onRename}
              onDelete={onDelete}
              onAddChild={onAddChild}
              onManageCounters={onManageCounters}
              variant={variant}
              doneSet={doneSet}
              onToggleOccurrence={onToggleOccurrence}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
