import os
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError
from dotenv import load_dotenv

POINTS_MAP = {
    "new_class": 3,
    "revision": 2,
    "ticket_resolved": 4,
}
ACTION_LABELS = {
    "new_class": "New Class",
    "revision": "Revision",
    "ticket_resolved": "Ticket Resolved",
}

MILESTONES = [
    {"points": 20, "reward": "Coffee Treat"},
    {"points": 40, "reward": "Movie Night"},
    {"points": 70, "reward": "Dinner Out"},
    {"points": 100, "reward": "Weekend Mini Trip"},
]

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env", override=True)

PLAYERS = ("kapil", "divya")

app = FastAPI(title="Kapil vs Divya Race API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_mongo_client = None
logger = logging.getLogger("race-api")


class AddPointsRequest(BaseModel):
    player_id: str
    action_type: str
    detail: str = ""


def _settings():
    return {
        "race_doc_id": os.getenv("RACE_DOC_ID", "kapil_divya_race"),
        "mongodb_uri": os.getenv("MONGODB_URI", ""),
        "mongodb_db": os.getenv("MONGODB_DB", "racing_challenge"),
        "mongodb_collection": os.getenv("MONGODB_COLLECTION", "race_state"),
        "app_timezone": os.getenv("APP_TIMEZONE", "Asia/Kolkata"),
    }


def _current_date_str() -> str:
    settings = _settings()
    tz = ZoneInfo(settings["app_timezone"])
    return datetime.now(tz).date().isoformat()


def _day_doc_id(date_str: str) -> str:
    settings = _settings()
    return f"{settings['race_doc_id']}:{date_str}"


def _get_collection():
    global _mongo_client
    settings = _settings()
    mongodb_uri = settings["mongodb_uri"]
    if not mongodb_uri:
        raise RuntimeError("MONGODB_URI is not configured")

    if _mongo_client is None:
        _mongo_client = MongoClient(mongodb_uri, serverSelectionTimeoutMS=5000)

    return _mongo_client[settings["mongodb_db"]][settings["mongodb_collection"]]


def _default_state_doc() -> Dict[str, Any]:
    date_str = _current_date_str()
    return _default_state_doc_for_date(date_str)


def _default_state_doc_for_date(date_str: str) -> Dict[str, Any]:
    return {
        "_id": _day_doc_id(date_str),
        "date": date_str,
        "points": {player: 0 for player in PLAYERS},
        "reached": {player: [] for player in PLAYERS},
        "history": {player: [] for player in PLAYERS},
        "milestones": MILESTONES,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _normalize_state_doc(state: Dict[str, Any]) -> Dict[str, Any]:
    points = state.get("points", {})
    reached = state.get("reached", {})
    history = state.get("history", {})

    if not isinstance(points, dict):
        points = {}
    if not isinstance(reached, dict):
        reached = {}
    if not isinstance(history, dict):
        history = {}

    normalized_points = {}
    normalized_reached = {}
    normalized_history = {}

    for player in PLAYERS:
        player_points = points.get(player, 0)
        if not isinstance(player_points, int):
            try:
                player_points = int(player_points)
            except (TypeError, ValueError):
                player_points = 0
        normalized_points[player] = player_points

        player_reached = reached.get(player, [])
        if not isinstance(player_reached, list):
            player_reached = []
        normalized_reached[player] = [mark for mark in player_reached if isinstance(mark, int)]

        player_history = history.get(player, [])
        if not isinstance(player_history, list):
            player_history = []
        cleaned_history = []
        for item in player_history:
            if not isinstance(item, dict):
                continue
            cleaned_history.append({
                "action_type": item.get("action_type", ""),
                "action_label": item.get("action_label", ""),
                "detail": item.get("detail", ""),
                "points": int(item.get("points", 0)) if str(item.get("points", "0")).isdigit() else 0,
                "created_at": item.get("created_at", ""),
            })
        normalized_history[player] = cleaned_history

    state["points"] = normalized_points
    state["reached"] = normalized_reached
    state["history"] = normalized_history
    state["milestones"] = MILESTONES
    state["date"] = state.get("date", "")
    return state


def _ensure_state_doc(collection, date_str: str) -> Dict[str, Any]:
    doc_id = _day_doc_id(date_str)
    doc = collection.find_one({"_id": doc_id})
    if doc:
        return _normalize_state_doc(doc)

    default_doc = _default_state_doc_for_date(date_str)
    try:
        collection.insert_one(default_doc)
    except DuplicateKeyError:
        pass

    doc = collection.find_one({"_id": doc_id})
    if doc:
        return _normalize_state_doc(doc)
    return default_doc


def _get_state_for_date(collection, date_str: str) -> Dict[str, Any]:
    doc_id = _day_doc_id(date_str)
    doc = collection.find_one({"_id": doc_id})
    if doc:
        return _normalize_state_doc(doc)
    return _default_state_doc_for_date(date_str)


def _winner_counts(collection) -> Dict[str, int]:
    settings = _settings()
    prefix = f"{settings['race_doc_id']}:"
    docs = collection.find({"_id": {"$regex": f"^{prefix}"}})
    counts = {"kapil": 0, "divya": 0, "tie": 0}

    for doc in docs:
        state = _normalize_state_doc(doc)
        kapil_points = state["points"].get("kapil", 0)
        divya_points = state["points"].get("divya", 0)
        if kapil_points > divya_points:
            counts["kapil"] += 1
        elif divya_points > kapil_points:
            counts["divya"] += 1
        else:
            counts["tie"] += 1
    return counts


def _available_dates(collection) -> List[str]:
    settings = _settings()
    prefix = f"{settings['race_doc_id']}:"
    docs = collection.find({"_id": {"$regex": f"^{prefix}"}}, {"date": 1}).sort("date", -1)
    dates = []
    for doc in docs:
        date_str = doc.get("date")
        if isinstance(date_str, str) and date_str:
            dates.append(date_str)
    return dates


def _evaluate_rewards(player_id: str, points: Dict[str, int], reached: Dict[str, list]) -> None:
    current_points = points[player_id]
    player_reached = reached[player_id]
    for milestone in MILESTONES:
        point_mark = milestone["points"]
        if current_points >= point_mark and point_mark not in player_reached:
            player_reached.append(point_mark)


@app.get("/state")
def get_state(date: str | None = Query(default=None)):
    try:
        collection = _get_collection()
        today = _current_date_str()
        selected_date = date or today
        if selected_date == today:
            state = _ensure_state_doc(collection, selected_date)
        else:
            state = _get_state_for_date(collection, selected_date)
        return {
            "date": selected_date,
            "today": today,
            "editable": selected_date == today,
            "points": state["points"],
            "reached": state["reached"],
            "history": state["history"],
            "milestones": MILESTONES,
            "winner_counts": _winner_counts(collection),
        }
    except Exception as err:
        logger.exception("GET /state failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.get("/days")
def get_days():
    try:
        collection = _get_collection()
        today = _current_date_str()
        dates = _available_dates(collection)
        if today not in dates:
            _ensure_state_doc(collection, today)
            dates = _available_dates(collection)
        return {
            "today": today,
            "dates": dates,
            "winner_counts": _winner_counts(collection),
        }
    except Exception as err:
        logger.exception("GET /days failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.post("/points")
def add_points(payload: AddPointsRequest):
    try:
        today = _current_date_str()
        race_doc_id = _day_doc_id(today)
        if payload.player_id not in PLAYERS:
            raise HTTPException(status_code=400, detail="Unknown player_id")

        if payload.action_type not in POINTS_MAP:
            raise HTTPException(status_code=400, detail="Unknown action_type")

        collection = _get_collection()
        state = _ensure_state_doc(collection, today)

        points = state["points"]
        reached = state["reached"]
        history = state["history"]
        points[payload.player_id] += POINTS_MAP[payload.action_type]
        _evaluate_rewards(payload.player_id, points, reached)
        detail = (payload.detail or "").strip()
        history_entry = {
            "action_type": payload.action_type,
            "action_label": ACTION_LABELS[payload.action_type],
            "detail": detail or ACTION_LABELS[payload.action_type],
            "points": POINTS_MAP[payload.action_type],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        history[payload.player_id].insert(0, history_entry)

        collection.update_one(
            {"_id": race_doc_id},
            {"$set": {
                "points": points,
                "reached": reached,
                "history": history,
                "milestones": MILESTONES,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )

        return {
            "message": "Points updated",
            "date": today,
            "editable": True,
            "points": points,
            "reached": reached,
            "history": history,
            "winner_counts": _winner_counts(collection),
        }
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("POST /points failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.post("/reset")
def reset_race():
    try:
        today = _current_date_str()
        race_doc_id = _day_doc_id(today)
        points = {player: 0 for player in PLAYERS}
        reached = {player: [] for player in PLAYERS}
        history = {player: [] for player in PLAYERS}

        collection = _get_collection()
        collection.update_one(
            {"_id": race_doc_id},
            {"$set": {
                "date": today,
                "points": points,
                "reached": reached,
                "history": history,
                "milestones": MILESTONES,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )

        return {
            "message": "Race reset",
            "date": today,
            "editable": True,
            "points": points,
            "reached": reached,
            "history": history,
            "winner_counts": _winner_counts(collection),
        }
    except Exception as err:
        logger.exception("POST /reset failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.get("/")
def health():
    return {"ok": True, "service": "kapil-divya-race-api"}


handler = Mangum(app)
