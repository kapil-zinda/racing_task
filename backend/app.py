import os
import logging
import uuid
from urllib.parse import quote
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

try:
    import boto3
except ImportError:
    boto3 = None

POINTS_MAP = {
    "new_class": 3,
    "revision": 2,
    "ticket_resolved": 4,
    "test_completed": 4,
}
ACTION_LABELS = {
    "new_class": "New Class",
    "revision": "Revision",
    "ticket_resolved": "Ticket Resolved",
    "test_completed": "Test Completed",
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
    test_type: str = ""
    detail: str = ""


class CreateSessionRequest(BaseModel):
    user_id: str
    subject: str
    topic: str
    session_type: str  # study | revision
    modes: List[str] = []  # audio | video | screen
    notes: str


class SessionStatusRequest(BaseModel):
    status: str  # started | paused | resumed | stopped
    elapsed_seconds: int = 0


class PresignRequest(BaseModel):
    media_type: str  # audio | video | screen
    content_type: str = "application/octet-stream"
    extension: str = "webm"


class MultipartStartRequest(BaseModel):
    media_type: str  # audio | video | screen
    content_type: str = "application/octet-stream"
    extension: str = "webm"


class MultipartPartRequest(BaseModel):
    media_type: str  # audio | video | screen
    upload_id: str
    part_number: int


class UploadedPart(BaseModel):
    part_number: int
    etag: str


class MultipartCompleteRequest(BaseModel):
    media_type: str  # audio | video | screen
    upload_id: str
    parts: List[UploadedPart]


class MultipartAbortRequest(BaseModel):
    media_type: str  # audio | video | screen
    upload_id: str


def _session_id() -> str:
    return f"session:{uuid.uuid4().hex}"


def _settings():
    return {
        "race_doc_id": os.getenv("RACE_DOC_ID", "kapil_divya_race"),
        "mongodb_uri": os.getenv("MONGODB_URI", ""),
        "mongodb_db": os.getenv("MONGODB_DB", "racing_challenge"),
        "mongodb_collection": os.getenv("MONGODB_COLLECTION", "race_state"),
        "mongodb_sessions_collection": os.getenv("MONGODB_SESSIONS_COLLECTION", "study_sessions"),
        "app_timezone": os.getenv("APP_TIMEZONE", "Asia/Kolkata"),
        "aws_region": os.getenv("AWS_REGION", "ap-south-1"),
        "recording_bucket": os.getenv("RECORDING_BUCKET", ""),
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


def _get_sessions_collection():
    global _mongo_client
    settings = _settings()
    mongodb_uri = settings["mongodb_uri"]
    if not mongodb_uri:
        raise RuntimeError("MONGODB_URI is not configured")

    if _mongo_client is None:
        _mongo_client = MongoClient(mongodb_uri, serverSelectionTimeoutMS=5000)

    return _mongo_client[settings["mongodb_db"]][settings["mongodb_sessions_collection"]]


def _get_s3_client():
    settings = _settings()
    if boto3 is None:
        raise RuntimeError("boto3 is not installed")
    aws_region = settings["aws_region"]
    return boto3.client(
        "s3",
        region_name=aws_region,
        endpoint_url=f"https://s3.{aws_region}.amazonaws.com",
    )


def _sanitize_key_part(value: str) -> str:
    return quote((value or "").strip().replace(" ", "_"), safe="_-")


def _session_media_key(doc: Dict[str, Any], media_type: str, ext: str) -> str:
    date_part = _sanitize_key_part(doc.get("date", _current_date_str()))
    subject_part = _sanitize_key_part(doc.get("subject", "general"))
    return f"study-sessions/{date_part}/{subject_part}/{doc.get('_id')}/{media_type}.{ext}"


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
        test_type = (payload.test_type or "").strip()
        detail = (payload.detail or "").strip()
        action_label = ACTION_LABELS[payload.action_type]
        if payload.action_type == "test_completed" and test_type:
            action_label = test_type
        history_entry = {
            "action_type": payload.action_type,
            "action_label": action_label,
            "detail": detail or action_label,
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


@app.post("/sessions")
def create_session(payload: CreateSessionRequest):
    try:
        if payload.user_id not in PLAYERS:
            raise HTTPException(status_code=400, detail="Invalid user_id")
        if payload.session_type not in {"study", "revision"}:
            raise HTTPException(status_code=400, detail="session_type must be study or revision")
        subject = payload.subject.strip()
        topic = payload.topic.strip()
        notes = payload.notes.strip()
        if not subject:
            raise HTTPException(status_code=400, detail="subject is required")
        if not topic:
            raise HTTPException(status_code=400, detail="topic is required")
        if not notes:
            raise HTTPException(status_code=400, detail="notes are required")

        modes = [m for m in payload.modes if m in {"audio", "video", "screen"}]
        date_str = _current_date_str()
        doc = {
            "_id": _session_id(),
            "doc_type": "study_session",
            "date": date_str,
            "user_id": payload.user_id,
            "subject": subject,
            "start_time": None,
            "total_time_minutes": 0,
            "topic": topic,
            "session_type": payload.session_type,
            "modes": modes,
            "notes": notes,
            "timer_only": len(modes) == 0,
            "status": "created",
            "elapsed_seconds": 0,
            "started_at": None,
            "stopped_at": None,
            "uploads": {"audio": None, "video": None, "screen": None},
            "events": [{
                "status": "created",
                "at": datetime.now(timezone.utc).isoformat(),
            }],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        collection = _get_sessions_collection()
        collection.insert_one(doc)
        return {"message": "Session created", "session": doc}
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("POST /sessions failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.get("/sessions")
def list_sessions(
    date: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
):
    try:
        collection = _get_sessions_collection()
        query: Dict[str, Any] = {"doc_type": "study_session"}
        query["date"] = date or _current_date_str()
        if user_id in PLAYERS:
            query["user_id"] = user_id
        docs = list(collection.find(query).sort("created_at", -1))
        return {"sessions": docs}
    except Exception as err:
        logger.exception("GET /sessions failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.get("/sessions/{session_id}")
def get_session(session_id: str):
    try:
        collection = _get_sessions_collection()
        doc = collection.find_one({"_id": session_id, "doc_type": "study_session"})
        if not doc:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"session": doc}
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("GET /sessions/{id} failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.post("/sessions/{session_id}/status")
def update_session_status(session_id: str, payload: SessionStatusRequest):
    try:
        if payload.status not in {"started", "paused", "resumed", "stopped"}:
            raise HTTPException(status_code=400, detail="Invalid status")

        collection = _get_sessions_collection()
        doc = collection.find_one({"_id": session_id, "doc_type": "study_session"})
        if not doc:
            raise HTTPException(status_code=404, detail="Session not found")
        current_status = doc.get("status", "created")
        if current_status == "stopped":
            raise HTTPException(status_code=400, detail="Session already stopped/closed")

        allowed_transitions = {
            "created": {"started"},
            "started": {"paused", "stopped"},
            "paused": {"resumed", "stopped"},
            "resumed": {"paused", "stopped"},
        }
        next_allowed = allowed_transitions.get(current_status, set())
        if payload.status not in next_allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid transition: {current_status} -> {payload.status}",
            )
        if payload.status in {"started", "resumed", "paused"}:
            other_active = collection.find_one({
                "doc_type": "study_session",
                "user_id": doc.get("user_id"),
                "status": {"$in": ["started", "resumed", "paused"]},
                "_id": {"$ne": session_id},
            })
            if other_active:
                raise HTTPException(
                    status_code=400,
                    detail="Only one active session is allowed per user. Stop the current active session first.",
                )

        event = {
            "status": payload.status,
            "elapsed_seconds": max(0, payload.elapsed_seconds),
            "at": datetime.now(timezone.utc).isoformat(),
        }
        update_fields = {
            "status": payload.status,
            "elapsed_seconds": max(0, payload.elapsed_seconds),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if payload.status == "started":
            update_fields["started_at"] = datetime.now(timezone.utc).isoformat()
            if not doc.get("start_time"):
                update_fields["start_time"] = datetime.now(timezone.utc).isoformat()
        if payload.status == "stopped":
            update_fields["stopped_at"] = datetime.now(timezone.utc).isoformat()
            update_fields["total_time_minutes"] = max(1, (max(0, payload.elapsed_seconds) + 59) // 60)

        collection.update_one(
            {"_id": session_id},
            {"$set": update_fields, "$push": {"events": event}},
        )
        updated = collection.find_one({"_id": session_id})
        return {"message": "Session status updated", "session": updated}
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("POST /sessions/{id}/status failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.post("/sessions/{session_id}/presign")
def create_presigned_upload(session_id: str, payload: PresignRequest):
    try:
        if payload.media_type not in {"audio", "video", "screen"}:
            raise HTTPException(status_code=400, detail="Invalid media_type")
        ext = (payload.extension or "webm").strip().lower().replace(".", "")
        if not ext:
            ext = "webm"

        settings = _settings()
        bucket = settings["recording_bucket"]
        if not bucket:
            raise HTTPException(status_code=500, detail="RECORDING_BUCKET is not configured")

        collection = _get_sessions_collection()
        doc = collection.find_one({"_id": session_id, "doc_type": "study_session"})
        if not doc:
            raise HTTPException(status_code=404, detail="Session not found")

        key = _session_media_key(doc, payload.media_type, ext)

        s3_client = _get_s3_client()
        upload_url = s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": bucket,
                "Key": key,
                "ContentType": payload.content_type,
            },
            ExpiresIn=3600,
        )

        object_url = f"https://{bucket}.s3.{settings['aws_region']}.amazonaws.com/{key}"
        collection.update_one(
            {"_id": session_id},
            {"$set": {
                f"uploads.{payload.media_type}": {
                    "key": key,
                    "content_type": payload.content_type,
                    "object_url": object_url,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return {
            "upload_url": upload_url,
            "object_url": object_url,
            "key": key,
            "bucket": bucket,
        }
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("POST /sessions/{id}/presign failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.post("/sessions/{session_id}/multipart/start")
def start_multipart_upload(session_id: str, payload: MultipartStartRequest):
    try:
        if payload.media_type not in {"audio", "video", "screen"}:
            raise HTTPException(status_code=400, detail="Invalid media_type")
        ext = (payload.extension or "webm").strip().lower().replace(".", "")
        if not ext:
            ext = "webm"

        settings = _settings()
        bucket = settings["recording_bucket"]
        if not bucket:
            raise HTTPException(status_code=500, detail="RECORDING_BUCKET is not configured")

        collection = _get_sessions_collection()
        doc = collection.find_one({"_id": session_id, "doc_type": "study_session"})
        if not doc:
            raise HTTPException(status_code=404, detail="Session not found")

        key = _session_media_key(doc, payload.media_type, ext)
        s3_client = _get_s3_client()
        resp = s3_client.create_multipart_upload(
            Bucket=bucket,
            Key=key,
            ContentType=payload.content_type,
        )
        upload_id = resp.get("UploadId", "")
        if not upload_id:
            raise HTTPException(status_code=500, detail="Failed to initialize multipart upload")

        collection.update_one(
            {"_id": session_id},
            {"$set": {
                f"uploads.{payload.media_type}": {
                    "key": key,
                    "content_type": payload.content_type,
                    "upload_id": upload_id,
                    "status": "multipart_started",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return {"bucket": bucket, "key": key, "upload_id": upload_id, "media_type": payload.media_type}
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("POST /sessions/{id}/multipart/start failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.post("/sessions/{session_id}/multipart/presign-part")
def presign_multipart_part(session_id: str, payload: MultipartPartRequest):
    try:
        if payload.media_type not in {"audio", "video", "screen"}:
            raise HTTPException(status_code=400, detail="Invalid media_type")
        if payload.part_number < 1:
            raise HTTPException(status_code=400, detail="part_number must be >= 1")

        settings = _settings()
        bucket = settings["recording_bucket"]
        if not bucket:
            raise HTTPException(status_code=500, detail="RECORDING_BUCKET is not configured")

        collection = _get_sessions_collection()
        doc = collection.find_one({"_id": session_id, "doc_type": "study_session"})
        if not doc:
            raise HTTPException(status_code=404, detail="Session not found")

        upload_info = (doc.get("uploads", {}) or {}).get(payload.media_type) or {}
        key = upload_info.get("key")
        upload_id = upload_info.get("upload_id")
        if not key or not upload_id:
            raise HTTPException(status_code=400, detail="Multipart upload not initialized for this media")
        if upload_id != payload.upload_id:
            raise HTTPException(status_code=400, detail="upload_id mismatch")

        s3_client = _get_s3_client()
        upload_url = s3_client.generate_presigned_url(
            "upload_part",
            Params={
                "Bucket": bucket,
                "Key": key,
                "UploadId": payload.upload_id,
                "PartNumber": payload.part_number,
            },
            ExpiresIn=3600,
        )
        return {"upload_url": upload_url, "key": key, "upload_id": payload.upload_id, "part_number": payload.part_number}
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("POST /sessions/{id}/multipart/presign-part failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.post("/sessions/{session_id}/multipart/complete")
def complete_multipart_upload(session_id: str, payload: MultipartCompleteRequest):
    try:
        if payload.media_type not in {"audio", "video", "screen"}:
            raise HTTPException(status_code=400, detail="Invalid media_type")
        if not payload.parts:
            raise HTTPException(status_code=400, detail="parts are required")

        settings = _settings()
        bucket = settings["recording_bucket"]
        if not bucket:
            raise HTTPException(status_code=500, detail="RECORDING_BUCKET is not configured")

        collection = _get_sessions_collection()
        doc = collection.find_one({"_id": session_id, "doc_type": "study_session"})
        if not doc:
            raise HTTPException(status_code=404, detail="Session not found")

        upload_info = (doc.get("uploads", {}) or {}).get(payload.media_type) or {}
        key = upload_info.get("key")
        upload_id = upload_info.get("upload_id")
        if not key or not upload_id:
            raise HTTPException(status_code=400, detail="Multipart upload not initialized for this media")
        if upload_id != payload.upload_id:
            raise HTTPException(status_code=400, detail="upload_id mismatch")

        parts = sorted(
            [{"ETag": p.etag, "PartNumber": p.part_number} for p in payload.parts],
            key=lambda item: item["PartNumber"],
        )
        s3_client = _get_s3_client()
        s3_client.complete_multipart_upload(
            Bucket=bucket,
            Key=key,
            UploadId=payload.upload_id,
            MultipartUpload={"Parts": parts},
        )

        object_url = f"https://{bucket}.s3.{settings['aws_region']}.amazonaws.com/{key}"
        collection.update_one(
            {"_id": session_id},
            {"$set": {
                f"uploads.{payload.media_type}": {
                    "key": key,
                    "content_type": upload_info.get("content_type", "application/octet-stream"),
                    "object_url": object_url,
                    "status": "completed",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return {"message": "Multipart upload completed", "media_type": payload.media_type, "object_url": object_url}
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("POST /sessions/{id}/multipart/complete failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.post("/sessions/{session_id}/multipart/abort")
def abort_multipart_upload(session_id: str, payload: MultipartAbortRequest):
    try:
        if payload.media_type not in {"audio", "video", "screen"}:
            raise HTTPException(status_code=400, detail="Invalid media_type")

        settings = _settings()
        bucket = settings["recording_bucket"]
        if not bucket:
            raise HTTPException(status_code=500, detail="RECORDING_BUCKET is not configured")

        collection = _get_sessions_collection()
        doc = collection.find_one({"_id": session_id, "doc_type": "study_session"})
        if not doc:
            raise HTTPException(status_code=404, detail="Session not found")

        upload_info = (doc.get("uploads", {}) or {}).get(payload.media_type) or {}
        key = upload_info.get("key")
        upload_id = upload_info.get("upload_id")
        if not key or not upload_id:
            return {"message": "No in-progress multipart upload to abort"}
        if upload_id != payload.upload_id:
            raise HTTPException(status_code=400, detail="upload_id mismatch")

        s3_client = _get_s3_client()
        s3_client.abort_multipart_upload(
            Bucket=bucket,
            Key=key,
            UploadId=payload.upload_id,
        )
        collection.update_one(
            {"_id": session_id},
            {"$set": {
                f"uploads.{payload.media_type}.status": "aborted",
                f"uploads.{payload.media_type}.updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return {"message": "Multipart upload aborted", "media_type": payload.media_type}
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("POST /sessions/{id}/multipart/abort failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.get("/sessions/{session_id}/playback-url")
def create_presigned_playback_url(session_id: str, media_type: str = Query(...)):
    try:
        if media_type not in {"audio", "video", "screen"}:
            raise HTTPException(status_code=400, detail="Invalid media_type")

        settings = _settings()
        bucket = settings["recording_bucket"]
        if not bucket:
            raise HTTPException(status_code=500, detail="RECORDING_BUCKET is not configured")

        collection = _get_sessions_collection()
        doc = collection.find_one({"_id": session_id, "doc_type": "study_session"})
        if not doc:
            raise HTTPException(status_code=404, detail="Session not found")

        upload_info = (doc.get("uploads", {}) or {}).get(media_type)
        key = (upload_info or {}).get("key")
        if not key:
            raise HTTPException(status_code=404, detail=f"No {media_type} recording found for this session")

        s3_client = _get_s3_client()
        playback_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=3600,
        )
        return {
            "playback_url": playback_url,
            "media_type": media_type,
            "key": key,
        }
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("GET /sessions/{id}/playback-url failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


@app.get("/")
def health():
    return {"ok": True, "service": "kapil-divya-race-api"}


handler = Mangum(app)
