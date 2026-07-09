"use client";
// Virtualized, drag-to-reparent goal tree. Flattens the nested tree into visible rows
// (respecting collapse + search), windows them with @tanstack/react-virtual, and uses
// @dnd-kit for drag-to-reparent (drop a node onto another to make it a child).

import { useMemo, useRef, useState } from "react";
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
} from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import Icon from "../Icon";

function flatten(roots, collapsed, out = [], depth = 0) {
  for (const n of roots) {
    out.push({ node: n, depth });
    if (n.children?.length && !collapsed.has(n.id)) flatten(n.children, collapsed, out, depth + 1);
  }
  return out;
}

function collectDescendants(node, set) {
  for (const c of node.children || []) { set.add(c.id); collectDescendants(c, set); }
  return set;
}

function TreeRow({ item, index, selectedId, onSelect, onToggle, onAddChild, onBulkAdd, onDelete, collapsed, onArrowNav }) {
  const { node, depth } = item;
  const hasChildren = node.children?.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: node.id });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: node.id });

  return (
    <div ref={dropRef} data-row-index={index}
         className={`tree-row ${selectedId === node.id ? "sel" : ""} ${isOver ? "drop-over" : ""} ${isDragging ? "dragging" : ""}`}
         style={{ paddingLeft: 8 + depth * 18 }} onClick={() => onSelect(node.id)}
         role="treeitem" tabIndex={0} aria-selected={selectedId === node.id}
         aria-level={depth + 1} aria-expanded={hasChildren ? !isCollapsed : undefined}
         onKeyDown={(e) => {
           if (e.target !== e.currentTarget) return; // let inner buttons handle their own keys
           if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(node.id); return; }
           // Arrow nav also selects the row so the detail panel follows keyboard focus.
           if (e.key === "ArrowDown") { e.preventDefault(); onSelect(node.id); onArrowNav(index + 1); return; }
           if (e.key === "ArrowUp") { e.preventDefault(); onSelect(node.id); onArrowNav(index - 1); return; }
           if (e.key === "ArrowRight" && hasChildren && isCollapsed) { e.preventDefault(); onToggle(node.id); return; }
           if (e.key === "ArrowLeft" && hasChildren && !isCollapsed) { e.preventDefault(); onToggle(node.id); }
         }}>
      <span className="tree-caret" onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(node.id); }}>
        {hasChildren ? (isCollapsed ? "▸" : "▾") : "·"}
      </span>
      <span ref={dragRef} {...listeners} {...attributes} className="tree-drag-handle" title="Drag to reparent">⠿</span>
      <span className={`tree-status-dot s-${node.status}`} />
      <span className="tree-label">{node.title}</span>
      <span className="tree-pct">{Math.round(node.progress || 0)}%</span>
      <span className="tree-row-actions" onClick={(e) => e.stopPropagation()}>
        <button className="goal-icon-btn sm" title="Add child" onClick={() => onAddChild(node.id)}><Icon name="plus" /></button>
        <button className="goal-icon-btn sm" title="Add multiple children" onClick={() => onBulkAdd(node)}><Icon name="layers" /></button>
        <button className="goal-icon-btn sm danger" title="Delete" onClick={() => onDelete(node)}><Icon name="trash" /></button>
      </span>
    </div>
  );
}

export default function GoalTree({ roots, selectedId, onSelect, onAddChild, onBulkAdd, onAddRoot, onMove, onDelete }) {
  const [collapsed, setCollapsed] = useState(new Set());
  const [query, setQuery] = useState("");
  const parentRef = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const nodeById = useMemo(() => {
    const map = new Map();
    const walk = (list) => list.forEach((n) => { map.set(n.id, n); walk(n.children || []); });
    walk(roots);
    return map;
  }, [roots]);

  const rows = useMemo(() => {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const matchIds = new Set();
      const walk = (list, ancestors) => list.forEach((n) => {
        const chain = [...ancestors, n];
        if ((n.title || "").toLowerCase().includes(q)) chain.forEach((a) => matchIds.add(a.id));
        walk(n.children || [], chain);
      });
      walk(roots, []);
      return flatten(roots, new Set()).filter((r) => matchIds.has(r.node.id));
    }
    return flatten(roots, collapsed);
  }, [roots, collapsed, query]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 12,
  });

  const toggle = (id) => setCollapsed((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Arrow-key row-to-row navigation: virtualization means the target row may not
  // be mounted yet, so scroll it into view first, then focus it once it renders.
  const focusRow = (targetIndex) => {
    if (targetIndex < 0 || targetIndex >= rows.length) return;
    virtualizer.scrollToIndex(targetIndex, { align: "auto" });
    requestAnimationFrame(() => {
      const el = parentRef.current?.querySelector(`[data-row-index="${targetIndex}"]`);
      el?.focus();
    });
  };

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const dragged = nodeById.get(active.id);
    if (!dragged) return;
    // Disallow dropping into own subtree.
    const descendants = collectDescendants(dragged, new Set());
    if (descendants.has(over.id)) return;
    if (dragged.parent_id === over.id) return; // already a child of target
    onMove(active.id, over.id);
  };

  return (
    <div className="goal-tree">
      <div className="goal-tree-toolbar">
        <input className="goal-tree-search" placeholder="Search nodes…" value={query}
               onChange={(e) => setQuery(e.target.value)} />
        <button className="goal-btn ghost tiny" onClick={onAddRoot}>+ Top-level</button>
        <button className="goal-btn ghost tiny" onClick={() => onBulkAdd(null)} title="Bulk-add top-level nodes"><Icon name="layers" /> Bulk</button>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div ref={parentRef} className="goal-tree-scroll" role="tree" aria-label="Goal tree">
          {rows.length === 0 ? (
            <div className="goal-hint" style={{ padding: 16 }}>
              {query ? "No matching nodes." : "Empty tree — add a top-level node to begin."}
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => (
                <div key={rows[vi.index].node.id}
                     style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: 34 }}>
                  <TreeRow item={rows[vi.index]} index={vi.index} selectedId={selectedId} onSelect={onSelect}
                           onToggle={toggle} onAddChild={onAddChild} onBulkAdd={onBulkAdd}
                           onDelete={onDelete} collapsed={collapsed} onArrowNav={focusRow} />
                </div>
              ))}
            </div>
          )}
        </div>
      </DndContext>
    </div>
  );
}
