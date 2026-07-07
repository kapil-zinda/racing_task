"""Report of the Day.

Aggregates what a user did on a given day across the selected features
(time tracker, goals, QnA, answer evaluation, interview, mind maps) into one
payload the frontend renders as a downloadable PDF. Every section is best-effort:
a failure in one section must not sink the whole report.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .context import (
    answer_evaluations_collection,
    day_activities_collection,
    goal_activity_collection,
    goal_nodes_collection,
    goals_collection,
    interview_sessions_collection,
    logger,
    mindmaps_collection,
    qna_messages_collection,
    qna_sessions_collection,
)

VALID_SECTIONS = ["time_spend", "goals", "qna", "answer_eval", "interview", "mindmap"]

# Goal-activity actions that count as "work done today".
_GOAL_ACTIONS = ["node_updated", "metric_incremented", "node_created", "nodes_bulk_created", "goal_created"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _window(date: str):
    """Lexicographic ISO-timestamp bounds for a YYYY-MM-DD day (UTC clock)."""
    return f"{date}T00:00:00", f"{date}T23:59:59.999999+00:00"


def _int(v) -> int:
    try:
        return int(v)
    except Exception:
        return 0


# ── Sections ──────────────────────────────────────────────────────────────────
def _time_spend(uid: str, date: str) -> Dict[str, Any]:
    rows = list(
        day_activities_collection()
        .find({"user_id": uid, "date": date}, {"user_id": 0})
        .sort("start_time", 1)
    )
    entries: List[Dict[str, Any]] = []
    by_cat: Dict[str, int] = {}
    total = 0
    for r in rows:
        mins = _int(r.get("duration_minutes"))
        total += mins
        cat = (r.get("category") or "Other").strip() or "Other"
        by_cat[cat] = by_cat.get(cat, 0) + mins
        entries.append({
            "title": r.get("title") or "(untitled)",
            "category": cat,
            "start_time": r.get("start_time") or "",
            "end_time": r.get("end_time") or "",
            "duration_minutes": mins,
        })
    by_category = [{"category": k, "minutes": v} for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1])]
    return {"entries": entries, "total_minutes": total, "by_category": by_category}


def _goals(uid: str, date: str) -> Dict[str, Any]:
    goals = list(goals_collection().find({"user_id": uid}, {"name": 1}))
    if not goals:
        return {"items": [], "total_updates": 0}
    goal_name = {str(g["_id"]): g.get("name") or "Untitled goal" for g in goals}
    goal_ids = list(goal_name.keys())

    nodes = list(goal_nodes_collection().find({"user_id": uid}, {"title": 1, "goal_id": 1}))
    node_title = {str(n["_id"]): (n.get("title") or "Task") for n in nodes}

    start, end = _window(date)
    acts = list(
        goal_activity_collection()
        .find({"goal_id": {"$in": goal_ids}, "action": {"$in": _GOAL_ACTIONS},
               "created_at": {"$gte": start, "$lte": end}})
        .sort("created_at", 1)
    )

    grouped: Dict[str, Dict[str, Any]] = {}
    total = 0
    for a in acts:
        gid = str(a.get("goal_id"))
        if gid not in goal_name:
            continue
        total += 1
        bucket = grouped.setdefault(gid, {"goal": goal_name[gid], "tasks": []})
        nid = a.get("node_id")
        title = node_title.get(str(nid), "") if nid else ""
        bucket["tasks"].append({
            "title": title or (a.get("action") or "").replace("_", " "),
            "action": (a.get("action") or "").replace("_", " "),
            "new_value": _short(a.get("new_value")),
        })
    return {"items": list(grouped.values()), "total_updates": total}


def _short(v) -> str:
    if v is None:
        return ""
    s = str(v)
    return s[:60]


def _qna(uid: str, date: str) -> Dict[str, Any]:
    sessions = list(qna_sessions_collection().find({"user_id": uid}, {"_id": 1}))
    sess_ids = [s["_id"] for s in sessions]
    if not sess_ids:
        return {"questions_asked": 0, "sessions": 0}
    start, end = _window(date)
    count = qna_messages_collection().count_documents({
        "session_id": {"$in": sess_ids}, "role": "user",
        "created_at": {"$gte": start, "$lte": end},
    })
    active_sessions = len(qna_messages_collection().distinct("session_id", {
        "session_id": {"$in": sess_ids}, "role": "user",
        "created_at": {"$gte": start, "$lte": end},
    }))
    return {"questions_asked": _int(count), "sessions": _int(active_sessions)}


def _answer_eval(uid: str, date: str) -> Dict[str, Any]:
    start, end = _window(date)
    docs = list(
        answer_evaluations_collection()
        .find({"doc_type": "answer_evaluation", "user_id": uid,
               "created_at": {"$gte": start, "$lte": end}})
        .sort("created_at", 1)
    )
    items = []
    total_awarded = 0.0
    total_max = 0
    for d in docs:
        res = d.get("result") or {}
        qs = []
        for q in (res.get("questions") or []):
            qs.append({
                "question_text": (q.get("question_text") or "").strip(),
                "awarded_marks": q.get("awarded_marks"),
                "max_marks": q.get("max_marks"),
            })
        ta = res.get("total_awarded")
        tm = res.get("total_max")
        if isinstance(ta, (int, float)):
            total_awarded += ta
        total_max += _int(tm)
        items.append({
            "filename": d.get("filename") or "answer.pdf",
            "subject": d.get("subject") or "",
            "status": d.get("status"),
            "total_awarded": ta,
            "total_max": tm,
            "questions": qs,
        })
    return {
        "count": len(items),
        "items": items,
        "total_awarded": round(total_awarded, 1),
        "total_max": total_max,
    }


def _interview(uid: str, date: str) -> Dict[str, Any]:
    start, end = _window(date)
    docs = list(
        interview_sessions_collection()
        .find({"doc_type": "interview_session", "user_id": uid,
               "created_at": {"$gte": start, "$lte": end}})
        .sort("created_at", 1)
    )
    items = []
    for d in docs:
        overall = (d.get("report") or {}).get("overall") or {}
        items.append({
            "created_at": d.get("created_at"),
            "question_count": _int(d.get("question_count")),
            "status": d.get("status"),
            "overall_score": overall.get("score"),
            "verdict": overall.get("verdict") or "",
        })
    return {"count": len(items), "items": items}


def _mindmap(uid: str, date: str) -> Dict[str, Any]:
    start, end = _window(date)
    # Mind maps store camelCase createdAt/updatedAt (ISO). Match either falling in the day.
    docs = list(mindmaps_collection().find(
        {"user_id": uid, "$or": [
            {"updatedAt": {"$gte": start, "$lte": end}},
            {"createdAt": {"$gte": start, "$lte": end}},
        ]},
        {"title": 1, "updatedAt": 1, "createdAt": 1},
    ))
    items = [{
        "title": d.get("title") or "Untitled Mind Map",
        "created": (d.get("createdAt") or "") >= start,
    } for d in docs]
    return {"count": len(items), "items": items}


_BUILDERS = {
    "time_spend": _time_spend,
    "goals": _goals,
    "qna": _qna,
    "answer_eval": _answer_eval,
    "interview": _interview,
    "mindmap": _mindmap,
}


def day_report_payload(user_id: str, date: str = "", sections: Optional[List[str]] = None) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Authentication required")
    day = (date or "").strip() or _today()
    picked = [s for s in (sections or VALID_SECTIONS) if s in _BUILDERS]
    if not picked:
        raise ValueError("Select at least one section for the report.")

    out: Dict[str, Any] = {}
    for key in picked:
        try:
            out[key] = _BUILDERS[key](uid, day)
        except Exception:
            logger.exception("report section %s failed for user=%s", key, uid)
            out[key] = {"error": True}
    return {"date": day, "generated_at": _now_iso(), "sections": out}
