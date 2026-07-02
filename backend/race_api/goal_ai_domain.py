"""Universal Goal OS — AI features + analytics-lite helpers.

- generate_goal_from_text: natural-language → hierarchical goal (goal + node tree +
  metric templates), inserted via the same paths as manual creation.
- forecast_goal: projects a completion date from the recent completion rate.
- weekly_review / daily_plan: summarise progress and pick next actionable nodes.

The LLM is only used for generation; forecast/review/plan are deterministic so they work
without an API key.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from bson import ObjectId

from .context import (
    goal_activity_collection,
    goal_metrics_collection,
    goal_nodes_collection,
    goals_collection,
    logger,
    settings,
)
from .goal_domain import _uid, create_goal, ensure_goal_indexes
from .goal_progress_engine import recompute_full_goal

_MAX_AI_NODES = 400


def _chat_model() -> str:
    return (settings().get("openai_chat_model") or "gpt-5.4").strip() or "gpt-5.4"


def _openai_api_key() -> str:
    return (settings().get("openai_api_key") or "").strip()


# --- AI goal generation ---------------------------------------------------------

_GEN_SYSTEM = """You design goal hierarchies for a Universal Goal OS.
Given a user's natural-language goal, output a STRICT JSON object describing a tree.

Schema:
{
  "name": string,                 // the goal name
  "description": string,
  "icon": string,                 // a single emoji
  "category": string,
  "nodes": [                      // recursive tree
    {
      "title": string,
      "type": string,             // e.g. Subject, Topic, Lecture, Week, Day, Chapter
      "metrics": [                // optional measurable counters for THIS node
        { "name": string, "target_value": number, "unit": string }
      ],
      "children": [ ... ]         // same node shape, recursive
    }
  ]
}

Rules:
- Only leaf-ish study/action nodes should carry metrics (e.g. a Lecture with Video/Notes/Revision/MCQ).
- Keep it practical: at most ~150 nodes total, depth <= 5.
- Output ONLY the JSON object, no markdown, no commentary."""


def _count_nodes(nodes: List[Dict[str, Any]]) -> int:
    total = 0
    for n in nodes:
        total += 1 + _count_nodes(n.get("children") or [])
    return total


def _insert_ai_nodes(goal_id: str, user_id: str, nodes: List[Dict[str, Any]],
                     parent_id: str, path: List[str], depth: int, now: str, counter: List[int]) -> None:
    order = 0.0
    for spec in nodes:
        if counter[0] >= _MAX_AI_NODES:
            return
        title = str(spec.get("title") or "").strip()
        if not title:
            continue
        counter[0] += 1
        children = spec.get("children") or []
        metrics = [m for m in (spec.get("metrics") or []) if isinstance(m, dict) and str(m.get("name") or "").strip()]
        mode = "metric" if (metrics and not children) else "children_weighted" if children else "boolean"
        doc = {
            "goal_id": goal_id, "user_id": user_id, "parent_id": parent_id, "path": path,
            "depth": depth, "order": order, "title": title, "description": "",
            "type": str(spec.get("type") or "").strip(), "status": "todo", "weight": 1.0,
            "estimated_value": None, "actual_value": None, "unit": "", "progress": 0.0,
            "progress_mode": mode, "formula": "", "metadata": {},
            "created_at": now, "updated_at": now,
        }
        order += 1.0
        node_id = str(goal_nodes_collection().insert_one(doc).inserted_id)
        for m in metrics:
            goal_metrics_collection().insert_one({
                "goal_id": goal_id, "node_id": node_id, "user_id": user_id,
                "name": str(m.get("name")).strip(), "type": "number",
                "unit": str(m.get("unit") or "").strip(),
                "target_value": float(m.get("target_value") or 0), "current_value": 0.0,
                "min_value": None, "max_value": None, "created_at": now, "updated_at": now,
            })
        if children:
            _insert_ai_nodes(goal_id, user_id, children, node_id, path + [node_id], depth + 1, now, counter)


def generate_goal_from_text(user_id: str, prompt: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    text = (prompt or "").strip()
    if not text:
        raise ValueError("prompt is required")
    if not _openai_api_key():
        raise RuntimeError("OPENAI_API_KEY is required for AI goal generation")

    try:
        from openai import OpenAI
    except ImportError as err:  # pragma: no cover
        raise RuntimeError("openai package is not installed") from err

    client = OpenAI(api_key=_openai_api_key())
    resp = client.chat.completions.create(
        model=_chat_model(),
        messages=[{"role": "system", "content": _GEN_SYSTEM}, {"role": "user", "content": text}],
        response_format={"type": "json_object"},
    )
    content = resp.choices[0].message.content or "{}"
    try:
        plan = json.loads(content)
    except json.JSONDecodeError as err:
        raise RuntimeError("AI returned invalid JSON") from err

    nodes = plan.get("nodes") or []
    if _count_nodes(nodes) > _MAX_AI_NODES:
        raise ValueError(f"Generated hierarchy too large (>{_MAX_AI_NODES} nodes)")

    goal = create_goal(uid, {
        "name": plan.get("name") or text[:80],
        "description": plan.get("description") or "",
        "icon": plan.get("icon") or "🎯",
        "category": plan.get("category") or "General",
    })
    now = datetime.now(timezone.utc).isoformat()
    _insert_ai_nodes(goal["id"], uid, nodes, None, [], 0, now, [0])
    recompute_full_goal(goal["id"])
    return {"goal": goals_collection().find_one({"_id": ObjectId(goal["id"])}) and
            {**goal, "progress": goals_collection().find_one({"_id": ObjectId(goal['id'])}).get("progress", 0)},
            "node_count": _count_nodes(nodes)}


# --- Forecast / review / plan (deterministic) ----------------------------------

def _owned_goal(user_id: str, goal_id: str) -> Dict[str, Any]:
    doc = goals_collection().find_one({"_id": ObjectId(goal_id), "user_id": user_id})
    if not doc:
        raise LookupError("Goal not found")
    return doc


def forecast_goal(user_id: str, goal_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    goal = _owned_goal(uid, goal_id)
    progress = float(goal.get("progress", 0) or 0)

    # Rate = progress gained over the last 14 days, approximated from "done"/increment activity.
    since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    recent = goal_activity_collection().count_documents({
        "goal_id": goal_id, "created_at": {"$gte": since},
        "action": {"$in": ["node_updated", "metric_incremented"]},
    })
    leaves = goal_nodes_collection().count_documents({"goal_id": goal_id})
    remaining_pct = max(0.0, 100.0 - progress)

    if recent <= 0 or progress >= 100:
        return {
            "goal_id": goal_id, "progress": round(progress, 1),
            "actions_per_day_recent": 0.0, "projected_days_remaining": None,
            "message": "Complete!" if progress >= 100 else "Not enough recent activity to forecast — start logging progress.",
        }

    actions_per_day = recent / 14.0
    # Rough: each action moves progress by (100 / total leaves-ish). Use nodes as denominator.
    pct_per_action = (100.0 / leaves) if leaves else 1.0
    pct_per_day = actions_per_day * pct_per_action
    days_remaining = round(remaining_pct / pct_per_day) if pct_per_day > 0 else None

    msg = None
    end_date = goal.get("end_date")
    if days_remaining is not None and end_date:
        try:
            target = datetime.fromisoformat(end_date[:10])
            days_to_target = (target - datetime.now(timezone.utc).replace(tzinfo=None)).days
            if days_to_target > 0 and days_remaining > days_to_target:
                msg = f"Behind target — pick up the pace to finish by {end_date[:10]}."
            elif days_to_target > 0:
                msg = f"On track to finish by {end_date[:10]}."
        except ValueError:
            pass

    return {
        "goal_id": goal_id, "progress": round(progress, 1),
        "actions_per_day_recent": round(actions_per_day, 2),
        "projected_days_remaining": days_remaining,
        "message": msg or f"At the current pace, ~{days_remaining} days to completion.",
    }


def weekly_review(user_id: str, goal_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    _owned_goal(uid, goal_id)
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    nodes = list(goal_nodes_collection().find({"goal_id": goal_id}))
    completed = [n for n in nodes if (n.get("status") == "done") or float(n.get("progress", 0) or 0) >= 100]
    in_progress = [n for n in nodes if n.get("status") == "in_progress"]
    stale = [n for n in nodes if not n.get("children") and float(n.get("progress", 0) or 0) < 100
             and (n.get("updated_at") or "") < week_ago]

    actions_this_week = goal_activity_collection().count_documents({
        "goal_id": goal_id, "created_at": {"$gte": week_ago},
        "action": {"$in": ["node_updated", "metric_incremented"]},
    })
    return {
        "goal_id": goal_id,
        "completed_count": len(completed),
        "in_progress_count": len(in_progress),
        "stale_count": len(stale),
        "actions_this_week": actions_this_week,
        "stale_nodes": [{"id": str(n["_id"]), "title": n.get("title", "")} for n in stale[:20]],
        "suggestions": (
            ["Great pace — keep the streak going."] if actions_this_week >= 15
            else ["Aim for a bit more each day."] if actions_this_week > 0
            else ["No progress logged this week — start with one small task today."]
        ),
    }


def daily_plan(user_id: str, goal_id: str, limit: int = 5) -> Dict[str, Any]:
    """Pick the next actionable leaf nodes (incomplete leaves), lowest progress first."""
    ensure_goal_indexes()
    uid = _uid(user_id)
    _owned_goal(uid, goal_id)
    nodes = list(goal_nodes_collection().find({"goal_id": goal_id}))
    children_of = set(n.get("parent_id") for n in nodes if n.get("parent_id"))
    leaves = [n for n in nodes if str(n["_id"]) not in children_of]
    actionable = [n for n in leaves if float(n.get("progress", 0) or 0) < 100 and n.get("status") != "skipped"]
    actionable.sort(key=lambda n: (n.get("status") == "todo", float(n.get("progress", 0) or 0)))
    picks = actionable[: max(1, min(int(limit or 5), 15))]
    return {
        "goal_id": goal_id,
        "plan": [{
            "id": str(n["_id"]), "title": n.get("title", ""),
            "progress": round(float(n.get("progress", 0) or 0), 1),
            "status": n.get("status", "todo"),
        } for n in picks],
    }
