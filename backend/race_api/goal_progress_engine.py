"""Universal Goal OS — progress engine.

Each node's progress (0..100) is derived from its `progress_mode`:
  - boolean          : 100 if status == "done" else 0 (leaf)
  - manual           : the node's stored `progress` value (user-set)
  - metric           : average of linked metrics' current/target ratios (leaf)
  - formula          : evaluate `formula` against metric/child values (see _eval_formula)
  - children_weighted: weighted average of child progress by `weight` (default)

Propagation is compute-on-write: after any leaf change we recompute that node and
then walk its ancestor `path` upward, finishing by writing the goal's rollup progress.
No background workers or realtime — callers refresh via the API.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from .context import goal_metrics_collection, goal_nodes_collection, goals_collection, logger

try:
    from bson import ObjectId
except Exception:  # pragma: no cover
    ObjectId = None  # type: ignore


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clamp(value: float) -> float:
    return max(0.0, min(100.0, float(value)))


def _metric_ratio(metric: Dict[str, Any]) -> float:
    try:
        target = float(metric.get("target_value") or 0)
        current = float(metric.get("current_value") or 0)
    except (TypeError, ValueError):
        return 0.0
    if target <= 0:
        return 100.0 if current > 0 else 0.0
    return _clamp(current / target * 100.0)


def _weighted_children(children: List[Dict[str, Any]]) -> float:
    total_w = 0.0
    acc = 0.0
    for child in children:
        try:
            w = float(child.get("weight", 1) or 0)
        except (TypeError, ValueError):
            w = 1.0
        if w <= 0:
            w = 1.0
        acc += w * float(child.get("progress", 0) or 0)
        total_w += w
    if total_w <= 0:
        return 0.0
    return _clamp(acc / total_w)


def _eval_formula(formula: str, metrics: List[Dict[str, Any]], children: List[Dict[str, Any]]) -> float:
    """Evaluate a progress formula in a restricted namespace.

    Variables available: each metric by name -> its ratio (0..100), and each direct
    child by title -> its progress (0..100). Names are lowercased with spaces removed.
    Falls back to weighted children (or 0) when the formula can't be evaluated.
    """
    expr = (formula or "").strip()
    if not expr:
        return _weighted_children(children) if children else 0.0
    ns: Dict[str, float] = {}
    for m in metrics:
        key = str(m.get("name") or "").strip().lower().replace(" ", "")
        if key:
            ns[key] = _metric_ratio(m)
    for c in children:
        key = str(c.get("title") or "").strip().lower().replace(" ", "")
        if key:
            ns[key] = float(c.get("progress", 0) or 0)
    # Normalize common unicode operators from the spec examples.
    expr = expr.replace("×", "*").replace("÷", "/").replace("−", "-").lower().replace(" ", "")
    if not all(ch.isalnum() or ch in "+-*/().%_" for ch in expr):
        logger.warning("rejecting unsafe goal formula: %r", formula)
        return _weighted_children(children) if children else 0.0
    try:
        value = eval(expr, {"__builtins__": {}}, ns)  # noqa: S307 — sanitized above, no builtins
        return _clamp(float(value))
    except Exception:  # noqa: BLE001
        logger.warning("goal formula eval failed: %r", formula)
        return _weighted_children(children) if children else 0.0


def _child_progress(goal_id: str, node_id: str) -> List[Dict[str, Any]]:
    return list(
        goal_nodes_collection().find(
            {"goal_id": goal_id, "parent_id": node_id},
            {"progress": 1, "weight": 1, "title": 1},
        )
    )


def compute_node_progress(node: Dict[str, Any]) -> float:
    """Compute a single node's progress from its current children/metrics/mode."""
    goal_id = node.get("goal_id")
    node_id = str(node.get("_id"))
    mode = (node.get("progress_mode") or "children_weighted").strip().lower()
    children = _child_progress(goal_id, node_id)

    if children and mode not in {"manual", "formula", "metric"}:
        return _weighted_children(children)
    if mode == "boolean":
        return 100.0 if (node.get("status") or "").lower() == "done" else 0.0
    if mode == "manual":
        return _clamp(node.get("progress", 0) or 0)
    if mode == "metric":
        metrics = list(goal_metrics_collection().find({"node_id": node_id}))
        if not metrics:
            return _clamp(node.get("progress", 0) or 0)
        return _clamp(sum(_metric_ratio(m) for m in metrics) / len(metrics))
    if mode == "formula":
        metrics = list(goal_metrics_collection().find({"node_id": node_id}))
        return _eval_formula(node.get("formula", ""), metrics, children)
    # Default leaf with no children and no special mode: boolean-style on status.
    if not children:
        return 100.0 if (node.get("status") or "").lower() == "done" else _clamp(node.get("progress", 0) or 0)
    return _weighted_children(children)


def _derived_status(node: Dict[str, Any], progress: float) -> str | None:
    """For progress-driven modes, keep status in sync with progress:
    0 -> todo, 0<p<100 -> in_progress, >=100 -> done. Returns None when status should be
    left as-is: boolean mode is user-controlled, explicit blocked/skipped are respected,
    and a children_weighted node with no children behaves like a manual done/undone leaf.
    """
    mode = (node.get("progress_mode") or "children_weighted").strip().lower()
    current = (node.get("status") or "").lower()
    if mode == "boolean" or current in {"blocked", "skipped"}:
        return None
    if mode == "children_weighted":
        node_id = str(node.get("_id"))
        has_children = goal_nodes_collection().count_documents(
            {"goal_id": node.get("goal_id"), "parent_id": node_id}
        ) > 0
        if not has_children:
            return None  # plain leaf — user toggles its status directly
    if progress >= 100:
        return "done"
    if progress > 0:
        return "in_progress"
    return "todo"


def _write_progress(node: Dict[str, Any], progress: float) -> None:
    node_id = str(node.get("_id"))
    update: Dict[str, Any] = {"progress": round(progress, 2), "updated_at": _now()}
    new_status = _derived_status(node, progress)
    if new_status and new_status != node.get("status"):
        update["status"] = new_status
    goal_nodes_collection().update_one({"_id": ObjectId(node_id)}, {"$set": update})


def recompute_goal_rollup(goal_id: str) -> float:
    """Recompute the goal's overall progress from its top-level nodes."""
    roots = list(
        goal_nodes_collection().find(
            {"goal_id": goal_id, "parent_id": None},
            {"progress": 1, "weight": 1, "title": 1},
        )
    )
    progress = _weighted_children(roots) if roots else 0.0
    goals_collection().update_one(
        {"_id": ObjectId(goal_id)},
        {"$set": {"progress": round(progress, 2), "updated_at": _now()}},
    )
    return progress


def recompute_upward(goal_id: str, node_id: str) -> float:
    """Recompute `node_id`, then each ancestor up its path, then the goal rollup.

    Returns the recomputed progress of the starting node.
    """
    node = goal_nodes_collection().find_one({"_id": ObjectId(node_id), "goal_id": goal_id})
    if not node:
        return 0.0
    progress = compute_node_progress(node)
    _write_progress(node, progress)
    # Ancestors are stored root-first in `path`; recompute deepest first.
    for ancestor_id in reversed(node.get("path", []) or []):
        ancestor = goal_nodes_collection().find_one({"_id": ObjectId(ancestor_id), "goal_id": goal_id})
        if not ancestor:
            continue
        _write_progress(ancestor, compute_node_progress(ancestor))
    recompute_goal_rollup(goal_id)
    return progress


def recompute_full_goal(goal_id: str) -> float:
    """Post-order recompute of every node in a goal (used after bulk insert / template use)."""
    nodes = list(goal_nodes_collection().find({"goal_id": goal_id}, {"depth": 1}))
    # Deepest nodes first so parents see fresh child progress.
    for node in sorted(nodes, key=lambda n: int(n.get("depth", 0) or 0), reverse=True):
        full = goal_nodes_collection().find_one({"_id": node["_id"], "goal_id": goal_id})
        if full:
            _write_progress(full, compute_node_progress(full))
    return recompute_goal_rollup(goal_id)
