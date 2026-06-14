"use client";

import { useRef } from "react";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `node_${Date.now()}_${idCounter}`;
}

export function createRow(depth = 0, label = "") {
  return { id: nextId(), label, depth };
}

// Flat rows (with depth) -> nested tree [{ label, children }]
export function rowsToTree(rows) {
  const roots = [];
  const stack = [];
  (rows || []).forEach((row) => {
    const label = String(row?.label || "").trim();
    if (!label) return;
    const depth = Math.max(0, Number(row?.depth || 0));
    const node = { label, children: [] };
    while (stack.length && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ node, depth });
  });
  return roots;
}

// Recursively count all nodes in a nested tree [{ label, children }]
export function countTreeNodes(tree) {
  if (!Array.isArray(tree)) return 0;
  return tree.reduce((total, node) => total + 1 + countTreeNodes(node?.children), 0);
}

// Nested tree [{ label, children }] -> flat rows (with depth)
export function treeToRows(tree, depth = 0, out = []) {
  (tree || []).forEach((node) => {
    out.push(createRow(depth, String(node?.label || "")));
    if (Array.isArray(node?.children) && node.children.length) {
      treeToRows(node.children, depth + 1, out);
    }
  });
  return out;
}

export default function JourneyTreeBuilder({ rows, onChange }) {
  const inputRefs = useRef({});

  const focusRow = (id) => {
    requestAnimationFrame(() => {
      inputRefs.current[id]?.focus();
    });
  };

  const setLabel = (idx, label) => {
    const next = [...rows];
    next[idx] = { ...next[idx], label };
    onChange(next);
  };

  const addRow = () => {
    const row = createRow(0);
    onChange([...rows, row]);
    focusRow(row.id);
  };

  const addRowAfter = (idx) => {
    const depth = rows[idx]?.depth || 0;
    const row = createRow(depth);
    const next = [...rows.slice(0, idx + 1), row, ...rows.slice(idx + 1)];
    onChange(next);
    focusRow(row.id);
  };

  const removeRow = (idx) => {
    const next = rows.filter((_, i) => i !== idx);
    onChange(next);
  };

  const shiftDepth = (idx, delta) => {
    const row = rows[idx];
    if (!row) return;
    const newDepth = row.depth + delta;
    if (newDepth < 0) return;
    if (delta > 0 && (idx === 0 || rows[idx - 1].depth < row.depth)) return;

    const oldDepth = row.depth;
    const next = [...rows];
    next[idx] = { ...row, depth: newDepth };
    for (let i = idx + 1; i < next.length; i += 1) {
      if (next[i].depth > oldDepth) {
        next[i] = { ...next[i], depth: next[i].depth + delta };
      } else {
        break;
      }
    }
    onChange(next);
    focusRow(row.id);
  };

  const handleKeyDown = (e, idx) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addRowAfter(idx);
    } else if (e.key === "Tab") {
      e.preventDefault();
      shiftDepth(idx, e.shiftKey ? -1 : 1);
    }
  };

  return (
    <section>
      <p className="day-state">Add subjects, chapters, or topics. Use ◀ ▶ arrows to put one under another.</p>

      {rows.length === 0 ? (
        <div className="area-empty">No topics yet — add your first one below.</div>
      ) : null}

      <div className="tree-builder-list">
        {rows.map((row, idx) => (
          <div className="tree-builder-row" style={{ paddingLeft: row.depth * 28 }} key={row.id}>
            <span className="tree-builder-depth" aria-hidden="true">{row.depth}</span>
            <button
              type="button"
              className="tree-builder-btn"
              aria-label="Outdent"
              disabled={row.depth === 0}
              onClick={() => shiftDepth(idx, -1)}
            >
              ◀
            </button>
            <button
              type="button"
              className="tree-builder-btn"
              aria-label="Indent"
              disabled={idx === 0 || rows[idx - 1].depth < row.depth}
              onClick={() => shiftDepth(idx, 1)}
            >
              ▶
            </button>
            <input
              ref={(el) => {
                inputRefs.current[row.id] = el;
              }}
              className="task-select tree-builder-input"
              placeholder="e.g. Maths"
              value={row.label}
              onChange={(e) => setLabel(idx, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
            />
            <button type="button" className="tree-builder-btn" aria-label="Add item below" onClick={() => addRowAfter(idx)}>
              +
            </button>
            <button type="button" className="tree-builder-btn danger" aria-label="Remove item" onClick={() => removeRow(idx)}>
              🗑️
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="area-add-btn" onClick={addRow}>
        + Add topic
      </button>
    </section>
  );
}
