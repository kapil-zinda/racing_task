from datetime import datetime, timezone
from typing import Any, Dict, List

from botocore.exceptions import ClientError

from .constants import MEDIA_TYPES, PLAYERS, RECORDER_MODE_MAP
from .context import (
    current_date_str,
    logger,
    s3_client,
    session_id,
    session_media_key,
    sessions_collection,
    settings,
)


def _normalize_modes(recorder_type: str, modes: List[str]) -> tuple[str, List[str]]:
    recorder = (recorder_type or "call").strip().lower().replace(" ", "_")
    if recorder not in RECORDER_MODE_MAP:
        recorder = "call"

    default_modes = RECORDER_MODE_MAP[recorder]
    raw_modes = [m for m in (modes or []) if isinstance(m, str)]
    clean_modes = [m.strip().lower() for m in raw_modes if m and m.strip().lower() in MEDIA_TYPES]
    unique_modes = []
    for mode in clean_modes:
        if mode not in unique_modes:
            unique_modes.append(mode)

    if recorder in {"audio", "video", "call", "pdf_explainer"}:
        unique_modes = list(default_modes)

    return recorder, unique_modes


def create_session_payload(payload) -> Dict[str, Any]:
    if payload.user_id not in PLAYERS:
        raise ValueError("Invalid user_id")
    if payload.session_type not in {"study", "revision"}:
        raise ValueError("session_type must be study or revision")

    subject = payload.subject.strip()
    topic = payload.topic.strip()
    notes = payload.notes.strip()
    if not subject:
        raise ValueError("subject is required")
    if not topic:
        raise ValueError("topic is required")
    if not notes:
        raise ValueError("notes are required")

    recorder_type, modes = _normalize_modes(payload.recorder_type, payload.modes)
    date_str = current_date_str()
    doc = {
        "_id": session_id(),
        "doc_type": "study_session",
        "date": date_str,
        "user_id": payload.user_id,
        "subject": subject,
        "start_time": None,
        "total_time_minutes": 0,
        "topic": topic,
        "session_type": payload.session_type,
        "recorder_type": recorder_type,
        "modes": modes,
        "notes": notes,
        "timer_only": len(modes) == 0,
        "status": "created",
        "elapsed_seconds": 0,
        "started_at": None,
        "stopped_at": None,
        "uploads": {"audio": None, "video": None, "screen": None, "attachment": None},
        "events": [{"status": "created", "at": datetime.now(timezone.utc).isoformat()}],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    sessions_collection().insert_one(doc)
    return {"message": "Session created", "session": doc}


def list_sessions_payload(date: str | None, user_id: str | None) -> Dict[str, Any]:
    query: Dict[str, Any] = {"doc_type": "study_session", "date": date or current_date_str()}
    if user_id in PLAYERS:
        query["user_id"] = user_id
    docs = list(sessions_collection().find(query).sort("created_at", -1))
    return {"sessions": docs}


def get_session_payload(session_id_value: str) -> Dict[str, Any]:
    doc = sessions_collection().find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")
    return {"session": doc}


def update_session_status_payload(session_id_value: str, payload) -> Dict[str, Any]:
    if payload.status not in {"started", "paused", "resumed", "stopped"}:
        raise ValueError("Invalid status")

    collection = sessions_collection()
    doc = collection.find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")

    current_status = doc.get("status", "created")
    if current_status == "stopped":
        raise ValueError("Session already stopped/closed")

    allowed_transitions = {
        "created": {"started"},
        "started": {"paused", "stopped"},
        "paused": {"resumed", "stopped"},
        "resumed": {"paused", "stopped"},
    }
    next_allowed = allowed_transitions.get(current_status, set())
    if payload.status not in next_allowed:
        raise ValueError(f"Invalid transition: {current_status} -> {payload.status}")

    if payload.status in {"started", "resumed", "paused"}:
        other_active = collection.find_one(
            {
                "doc_type": "study_session",
                "user_id": doc.get("user_id"),
                "status": {"$in": ["started", "resumed", "paused"]},
                "_id": {"$ne": session_id_value},
            }
        )
        if other_active:
            raise ValueError("Only one active session is allowed per user. Stop the current active session first.")

    elapsed_seconds = max(0, payload.elapsed_seconds)
    event = {
        "status": payload.status,
        "elapsed_seconds": elapsed_seconds,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    update_fields = {
        "status": payload.status,
        "elapsed_seconds": elapsed_seconds,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.status == "started":
        update_fields["started_at"] = datetime.now(timezone.utc).isoformat()
        if not doc.get("start_time"):
            update_fields["start_time"] = datetime.now(timezone.utc).isoformat()
    if payload.status == "stopped":
        update_fields["stopped_at"] = datetime.now(timezone.utc).isoformat()
        update_fields["total_time_minutes"] = max(1, (elapsed_seconds + 59) // 60)

    collection.update_one({"_id": session_id_value}, {"$set": update_fields, "$push": {"events": event}})
    updated = collection.find_one({"_id": session_id_value})
    return {"message": "Session status updated", "session": updated}


def create_presigned_upload_payload(session_id_value: str, payload) -> Dict[str, Any]:
    if payload.media_type not in MEDIA_TYPES:
        raise ValueError("Invalid media_type")
    ext = (payload.extension or "webm").strip().lower().replace(".", "") or "webm"

    cfg = settings()
    bucket = cfg["recording_bucket"]
    if not bucket:
        raise RuntimeError("RECORDING_BUCKET is not configured")

    collection = sessions_collection()
    doc = collection.find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")

    key = session_media_key(doc, payload.media_type, ext)
    upload_url = s3_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": payload.content_type},
        ExpiresIn=3600,
    )

    object_url = f"https://{bucket}.s3.{cfg['aws_region']}.amazonaws.com/{key}"
    collection.update_one(
        {"_id": session_id_value},
        {
            "$set": {
                f"uploads.{payload.media_type}": {
                    "key": key,
                    "content_type": payload.content_type,
                    "object_url": object_url,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    return {"upload_url": upload_url, "object_url": object_url, "key": key, "bucket": bucket}


def start_multipart_upload_payload(session_id_value: str, payload) -> Dict[str, Any]:
    if payload.media_type not in MEDIA_TYPES:
        raise ValueError("Invalid media_type")
    ext = (payload.extension or "webm").strip().lower().replace(".", "") or "webm"

    cfg = settings()
    bucket = cfg["recording_bucket"]
    if not bucket:
        raise RuntimeError("RECORDING_BUCKET is not configured")

    collection = sessions_collection()
    doc = collection.find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")

    key = session_media_key(doc, payload.media_type, ext)
    resp = s3_client().create_multipart_upload(Bucket=bucket, Key=key, ContentType=payload.content_type)
    upload_id = resp.get("UploadId", "")
    if not upload_id:
        raise RuntimeError("Failed to initialize multipart upload")

    collection.update_one(
        {"_id": session_id_value},
        {
            "$set": {
                f"uploads.{payload.media_type}": {
                    "key": key,
                    "content_type": payload.content_type,
                    "upload_id": upload_id,
                    "status": "multipart_started",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    return {"bucket": bucket, "key": key, "upload_id": upload_id, "media_type": payload.media_type}


def presign_multipart_part_payload(session_id_value: str, payload) -> Dict[str, Any]:
    if payload.media_type not in MEDIA_TYPES:
        raise ValueError("Invalid media_type")
    if payload.part_number < 1:
        raise ValueError("part_number must be >= 1")

    bucket = settings()["recording_bucket"]
    if not bucket:
        raise RuntimeError("RECORDING_BUCKET is not configured")

    doc = sessions_collection().find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")

    upload_info = (doc.get("uploads", {}) or {}).get(payload.media_type) or {}
    key = upload_info.get("key")
    upload_id = upload_info.get("upload_id")
    if not key or not upload_id:
        raise ValueError("Multipart upload not initialized for this media")
    if upload_id != payload.upload_id:
        raise ValueError("upload_id mismatch")

    upload_url = s3_client().generate_presigned_url(
        "upload_part",
        Params={"Bucket": bucket, "Key": key, "UploadId": payload.upload_id, "PartNumber": payload.part_number},
        ExpiresIn=3600,
    )
    return {"upload_url": upload_url, "key": key, "upload_id": payload.upload_id, "part_number": payload.part_number}


def complete_multipart_upload_payload(session_id_value: str, payload) -> Dict[str, Any]:
    if payload.media_type not in MEDIA_TYPES:
        raise ValueError("Invalid media_type")
    if not payload.parts:
        raise ValueError("parts are required")

    cfg = settings()
    bucket = cfg["recording_bucket"]
    if not bucket:
        raise RuntimeError("RECORDING_BUCKET is not configured")

    collection = sessions_collection()
    doc = collection.find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")

    upload_info = (doc.get("uploads", {}) or {}).get(payload.media_type) or {}
    key = upload_info.get("key")
    upload_id = upload_info.get("upload_id")
    if not key or not upload_id:
        raise ValueError("Multipart upload not initialized for this media")
    if upload_id != payload.upload_id:
        raise ValueError("upload_id mismatch")

    parts = sorted(
        [{"ETag": p.etag, "PartNumber": p.part_number} for p in payload.parts],
        key=lambda item: item["PartNumber"],
    )
    s3_client().complete_multipart_upload(
        Bucket=bucket,
        Key=key,
        UploadId=payload.upload_id,
        MultipartUpload={"Parts": parts},
    )

    object_url = f"https://{bucket}.s3.{cfg['aws_region']}.amazonaws.com/{key}"
    collection.update_one(
        {"_id": session_id_value},
        {
            "$set": {
                f"uploads.{payload.media_type}": {
                    "key": key,
                    "content_type": upload_info.get("content_type", "application/octet-stream"),
                    "object_url": object_url,
                    "status": "completed",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    return {"message": "Multipart upload completed", "media_type": payload.media_type, "object_url": object_url}


def abort_multipart_upload_payload(session_id_value: str, payload) -> Dict[str, Any]:
    if payload.media_type not in MEDIA_TYPES:
        raise ValueError("Invalid media_type")

    bucket = settings()["recording_bucket"]
    if not bucket:
        raise RuntimeError("RECORDING_BUCKET is not configured")

    collection = sessions_collection()
    doc = collection.find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")

    upload_info = (doc.get("uploads", {}) or {}).get(payload.media_type) or {}
    key = upload_info.get("key")
    upload_id = upload_info.get("upload_id")
    if not key or not upload_id:
        return {"message": "No in-progress multipart upload to abort"}
    if upload_id != payload.upload_id:
        raise ValueError("upload_id mismatch")

    s3_client().abort_multipart_upload(Bucket=bucket, Key=key, UploadId=payload.upload_id)
    collection.update_one(
        {"_id": session_id_value},
        {
            "$set": {
                f"uploads.{payload.media_type}.status": "aborted",
                f"uploads.{payload.media_type}.updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    return {"message": "Multipart upload aborted", "media_type": payload.media_type}


def create_presigned_playback_url_payload(session_id_value: str, media_type: str) -> Dict[str, Any]:
    if media_type not in MEDIA_TYPES:
        raise ValueError("Invalid media_type")

    cfg = settings()
    bucket = cfg["recording_bucket"]
    if not bucket:
        raise RuntimeError("RECORDING_BUCKET is not configured")

    doc = sessions_collection().find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")

    upload_info = (doc.get("uploads", {}) or {}).get(media_type)
    key = (upload_info or {}).get("key")
    if not key:
        raise FileNotFoundError(f"No {media_type} recording found for this session")

    client = s3_client()
    try:
        client.head_object(Bucket=bucket, Key=key)
    except ClientError as err:
        code = (err.response or {}).get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchKey", "NotFound"}:
            raise FileNotFoundError(f"{media_type} recording file is not available yet (upload may be incomplete).")
    except Exception:  # best effort only
        logger.exception("head_object check failed")

    playback_url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=3600,
    )
    return {"playback_url": playback_url, "media_type": media_type, "key": key}
