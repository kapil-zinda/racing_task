"""Universal Goal OS — global search across goals and nodes."""

from __future__ import annotations

import re
from typing import Any, Dict

from .context import goal_nodes_collection, goals_collection
from .goal_domain import _uid, ensure_goal_indexes


def search(user_id: str, query: str, limit: int = 30) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    q = (query or "").strip()
    if not q:
        return {"goals": [], "nodes": []}
    lim = max(1, min(int(limit or 30), 100))
    rx = re.compile(re.escape(q), re.IGNORECASE)

    goals = list(goals_collection().find(
        {"user_id": uid, "$or": [{"name": rx}, {"description": rx}]}
    ).limit(lim))
    goal_hits = [{"id": str(g["_id"]), "name": g.get("name", ""), "icon": g.get("icon", "🎯"),
                  "progress": round(float(g.get("progress", 0) or 0), 1)} for g in goals]

    nodes = list(goal_nodes_collection().find(
        {"user_id": uid, "$or": [{"title": rx}, {"description": rx}]}
    ).limit(lim))
    node_hits = [{"id": str(n["_id"]), "goal_id": n.get("goal_id"), "title": n.get("title", ""),
                  "type": n.get("type", ""), "status": n.get("status", ""),
                  "progress": round(float(n.get("progress", 0) or 0), 1)} for n in nodes]

    return {"query": q, "goals": goal_hits, "nodes": node_hits}
