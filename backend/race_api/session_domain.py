import json
from datetime import datetime, timezone
from typing import Any, Dict, List

from botocore.exceptions import ClientError

from .constants import MEDIA_TYPES, PLAYERS, RECORDER_MODE_MAP
from .context import (
    current_date_str,
    current_lambda_function_name,
    lambda_client,
    logger,
    s3_client,
    session_id,
    session_media_chunk_key,
    session_media_chunk_prefix,
    session_media_key,
    sessions_collection,
    settings,
)
from .ledger_domain import log_activity

# S3 multipart requires every part except the last to be >= 5 MiB.
CHUNK_CONCAT_PART_BYTES = 5 * 1024 * 1024


def _record_activity(doc_or_user, activity_type: str, *, duration_minutes: int = 0, meta: Dict[str, Any] | None = None) -> None:
    """Append a recorder activity to the user's activity ledger (best-effort — a
    ledger failure must never break recording)."""
    try:
        user_id = doc_or_user.get("user_id", "") if isinstance(doc_or_user, dict) else str(doc_or_user or "")
        if not user_id:
            return
        log_activity(user_id, activity_type, duration_minutes=duration_minutes, meta=meta or {})
    except Exception:
        logger.exception("ledger log_activity failed (%s)", activity_type)


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

    if recorder in {"audio", "video", "screen", "call", "pdf_explainer"}:
        unique_modes = list(default_modes)

    return recorder, unique_modes


def create_session_payload(payload) -> Dict[str, Any]:
    if not (payload.user_id or "").strip():
        raise ValueError("Invalid user_id")
    if payload.session_type not in {"study", "revision", "analysis", "test"}:
        raise ValueError("session_type must be study, revision or analysis")

    subject = payload.subject.strip()
    topic = payload.topic.strip()
    notes = (payload.notes or "").strip()
    if not subject:
        raise ValueError("subject is required")
    if not topic:
        raise ValueError("topic is required")
    recorder_type, modes = _normalize_modes(payload.recorder_type, payload.modes)
    test_source = (getattr(payload, "test_source", "") or "").strip()
    test_name = (getattr(payload, "test_name", "") or "").strip()
    test_number = str(getattr(payload, "test_number", "") or "").strip()

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
        "is_simple_record": bool(getattr(payload, "simple_record", False)),
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
    if test_source or test_name or test_number:
        doc["test_ref"] = {
            "source": test_source,
            "test_name": test_name,
            "test_number": test_number,
        }

    sessions_collection().insert_one(doc)
    logger.info(
        "session created id=%s user=%s recorder=%s modes=%s subject=%r",
        doc["_id"], doc.get("user_id"), recorder_type, modes, doc.get("subject"),
    )
    _record_activity(doc, "recording_created", meta={
        "session_id": doc["_id"], "recorder_type": recorder_type, "modes": modes, "subject": doc.get("subject"),
    })
    return {"message": "Session created", "session": doc}


def list_sessions_payload(date: str | None, user_id: str | None, scope: str | None = None) -> Dict[str, Any]:
    # Best-effort: clean up this user's abandoned recordings when they reload.
    if (user_id or "").strip():
        try:
            reap_stale_sessions(user_id)
        except Exception:
            logger.exception("reap_stale_sessions failed during list")
    query: Dict[str, Any] = {"doc_type": "study_session"}
    if (user_id or "").strip():
        query["user_id"] = user_id
    if (scope or "").strip().lower() == "simple":
        # Simple Records span every day, so do not filter by date.
        query["is_simple_record"] = True
    else:
        query["date"] = date or current_date_str()
    docs = list(sessions_collection().find(query).sort("created_at", -1))
    return {"sessions": docs}


def get_session_payload(session_id_value: str) -> Dict[str, Any]:
    doc = sessions_collection().find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")
    return {"session": doc}


def delete_session_payload(session_id_value: str) -> Dict[str, Any]:
    sid = (session_id_value or "").strip()
    if not sid:
        raise ValueError("session_id is required")

    collection = sessions_collection()
    doc = collection.find_one({"_id": sid, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")

    if doc.get("status") in {"started", "resumed", "paused"}:
        raise ValueError("Stop the active session before deleting it")

    uploads = doc.get("uploads", {}) or {}
    retained_s3_keys = []
    for media_type in MEDIA_TYPES:
        info = uploads.get(media_type)
        if isinstance(info, dict):
            key = (info.get("key") or "").strip()
            if key:
                retained_s3_keys.append(key)

    deleted = collection.delete_one({"_id": sid, "doc_type": "study_session"})
    if deleted.deleted_count == 0:
        raise LookupError("Session not found")

    logger.info("session deleted id=%s (kept %d S3 file(s))", sid, len(retained_s3_keys))
    _record_activity(doc, "recording_deleted", meta={"session_id": sid, "kept_s3_keys": len(retained_s3_keys)})
    return {
        "message": "Session deleted from app data. Recording files in S3 were kept.",
        "session_id": sid,
        "user_id": (doc.get("user_id") or "").strip(),
        "date": (doc.get("date") or "").strip(),
        "retained_s3_keys": retained_s3_keys,
    }
def _best_effort_finalize_multipart_uploads(collection, session_doc: Dict[str, Any]) -> None:
    cfg = settings()
    bucket = cfg["recording_bucket"]
    if not bucket:
        return

    doc_id = session_doc.get("_id")
    uploads = session_doc.get("uploads", {}) or {}
    now_iso = datetime.now(timezone.utc).isoformat()
    set_fields: Dict[str, Any] = {}
    client = s3_client()

    for media_type in MEDIA_TYPES:
        info = uploads.get(media_type) or {}
        key = info.get("key")
        upload_id = info.get("upload_id")
        if not key or not upload_id:
            continue

        try:
            complete_parts = []
            marker = 0
            while True:
                params = {"Bucket": bucket, "Key": key, "UploadId": upload_id}
                if marker:
                    params["PartNumberMarker"] = marker
                parts_resp = client.list_parts(**params)
                parts = parts_resp.get("Parts", []) or []
                complete_parts.extend(
                    [{"ETag": p["ETag"], "PartNumber": p["PartNumber"]} for p in parts if p.get("ETag") and p.get("PartNumber")]
                )
                if not parts_resp.get("IsTruncated"):
                    break
                marker = int(parts_resp.get("NextPartNumberMarker") or marker or 0)
                if marker <= 0:
                    break

            if complete_parts:
                client.complete_multipart_upload(
                    Bucket=bucket,
                    Key=key,
                    UploadId=upload_id,
                    MultipartUpload={"Parts": complete_parts},
                )
                object_url = f"https://{bucket}.s3.{cfg['aws_region']}.amazonaws.com/{key}"
                set_fields[f"uploads.{media_type}"] = {
                    "key": key,
                    "content_type": info.get("content_type", "application/octet-stream"),
                    "object_url": object_url,
                    "status": "completed",
                    "completed_at": now_iso,
                    "updated_at": now_iso,
                }
            else:
                client.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
                set_fields[f"uploads.{media_type}.status"] = "aborted"
                set_fields[f"uploads.{media_type}.updated_at"] = now_iso
        except ClientError:
            logger.exception("Best-effort multipart finalize failed for %s on %s", media_type, doc_id)
        except Exception:
            logger.exception("Unexpected multipart finalize failure for %s on %s", media_type, doc_id)

    if set_fields:
        set_fields["updated_at"] = now_iso
        collection.update_one({"_id": doc_id}, {"$set": set_fields})


def update_session_status_payload(session_id_value: str, payload) -> Dict[str, Any]:
    if payload.status not in {"started", "paused", "resumed", "stopped"}:
        raise ValueError("Invalid status")

    collection = sessions_collection()
    doc = collection.find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")

    current_status = doc.get("status", "created")
    logger.info(
        "session status change requested id=%s %s -> %s force=%s",
        session_id_value, current_status, payload.status, getattr(payload, "force_stop_previous", False),
    )
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
            if payload.status == "started":
                if not getattr(payload, "force_stop_previous", False):
                    raise ValueError(
                        "Another session is active in another tab/device. Pass force_stop_previous=true to stop it and continue."
                    )
                now_iso = datetime.now(timezone.utc).isoformat()
                other_elapsed = max(0, int(other_active.get("elapsed_seconds", 0) or 0))
                logger.info("force-stopping previously active session id=%s to start id=%s", other_active.get("_id"), session_id_value)
                _record_activity(other_active, "recording_force_stopped", duration_minutes=(other_elapsed // 60), meta={
                    "session_id": other_active.get("_id"), "stopped_by": session_id_value,
                })
                _best_effort_finalize_multipart_uploads(collection, other_active)
                # Also salvage a per-chunk recording (stitch whatever reached S3).
                bucket = settings()["recording_bucket"]
                if bucket:
                    for media_type in MEDIA_TYPES:
                        try:
                            if _media_has_chunks(bucket, other_active, media_type):
                                content_type = "audio/webm" if media_type == "audio" else "video/webm"
                                _trigger_media_concat(other_active.get("_id"), media_type, content_type, "webm")
                        except Exception:
                            logger.exception("Salvage concat (force-stop) failed for %s", media_type)
                collection.update_one(
                    {"_id": other_active.get("_id")},
                    {
                        "$set": {
                            "status": "stopped",
                            "stopped_at": now_iso,
                            "total_time_minutes": max(0, (other_elapsed + 59) // 60),
                            "updated_at": now_iso,
                        },
                        "$push": {
                            "events": {
                                "status": "stopped",
                                "elapsed_seconds": other_elapsed,
                                "at": now_iso,
                                "reason": "auto_stopped_by_new_session_start",
                            }
                        },
                    },
                )
            else:
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
    if payload.status in {"started", "resumed"}:
        # Seed the heartbeat so the reaper's 5-min window starts now, even before
        # the client's first heartbeat lands.
        update_fields["last_heartbeat"] = datetime.now(timezone.utc).isoformat()
    if payload.status == "started":
        update_fields["started_at"] = datetime.now(timezone.utc).isoformat()
        if not doc.get("start_time"):
            update_fields["start_time"] = datetime.now(timezone.utc).isoformat()
    if payload.status == "stopped":
        update_fields["stopped_at"] = datetime.now(timezone.utc).isoformat()
        update_fields["total_time_minutes"] = max(0, (elapsed_seconds + 59) // 60)

    collection.update_one({"_id": session_id_value}, {"$set": update_fields, "$push": {"events": event}})
    updated = collection.find_one({"_id": session_id_value})
    logger.info("session status updated id=%s -> %s elapsed=%ss", session_id_value, payload.status, elapsed_seconds)
    _record_activity(
        doc,
        f"recording_{payload.status}",
        duration_minutes=(elapsed_seconds // 60) if payload.status == "stopped" else 0,
        meta={"session_id": session_id_value, "elapsed_seconds": elapsed_seconds},
    )
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
    logger.info("multipart upload started id=%s media=%s key=%s", session_id_value, payload.media_type, key)
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
    logger.info("multipart upload completed id=%s media=%s parts=%d key=%s", session_id_value, payload.media_type, len(parts), key)
    _record_activity(doc, "recording_uploaded", meta={"session_id": session_id_value, "media_type": payload.media_type, "key": key})

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


def presign_chunk_upload_payload(session_id_value: str, payload) -> Dict[str, Any]:
    """Presign a PUT for a single recorder chunk stored as its own S3 object.

    Each ~1.5s chunk is uploaded immediately and durably, so a crash loses at
    most the last chunk. The objects are stitched together later by concat."""
    if payload.media_type not in MEDIA_TYPES:
        raise ValueError("Invalid media_type")
    if payload.seq < 0:
        raise ValueError("seq must be >= 0")

    bucket = settings()["recording_bucket"]
    if not bucket:
        raise RuntimeError("RECORDING_BUCKET is not configured")

    doc = sessions_collection().find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")

    key = session_media_chunk_key(doc, payload.media_type, payload.seq)
    upload_url = s3_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": payload.content_type},
        ExpiresIn=3600,
    )
    logger.debug("presigned chunk upload id=%s media=%s seq=%s", session_id_value, payload.media_type, payload.seq)
    return {"upload_url": upload_url, "key": key, "seq": payload.seq, "media_type": payload.media_type}


def concat_chunks_payload(session_id_value: str, payload) -> Dict[str, Any]:
    """Trigger concatenation of a media type's chunks into the final object.

    Concatenation can take longer than API Gateway's 29s synchronous limit for
    long recordings, so on Lambda we hand it to an async self-invocation (which
    gets the function's full timeout, up to 15 min) and return immediately; the
    client polls the session's upload status. Off Lambda (local dev) we run it
    inline."""
    if payload.media_type not in MEDIA_TYPES:
        raise ValueError("Invalid media_type")
    ext = (payload.extension or "webm").strip().lower().replace(".", "") or "webm"
    return _trigger_media_concat(session_id_value, payload.media_type, payload.content_type, ext)


def _trigger_media_concat(session_id_value: str, media_type: str, content_type: str, ext: str) -> Dict[str, Any]:
    """Mark the media 'processing' and run the concat — async on Lambda (self-invoke,
    full timeout) or inline off Lambda. Shared by the API endpoint and the reaper."""
    ext = (ext or "webm").strip().lower().replace(".", "") or "webm"
    if not settings()["recording_bucket"]:
        raise RuntimeError("RECORDING_BUCKET is not configured")

    now_iso = datetime.now(timezone.utc).isoformat()
    # Set the whole sub-document, not a dotted path: uploads.<media> starts as null
    # on a fresh session, and you can't create a field inside null. The final object
    # (with key/object_url) is written when the concat completes.
    sessions_collection().update_one(
        {"_id": session_id_value},
        {
            "$set": {
                f"uploads.{media_type}": {
                    "status": "processing",
                    "content_type": content_type,
                    "updated_at": now_iso,
                },
                "updated_at": now_iso,
            }
        },
    )

    fn_name = current_lambda_function_name()
    if fn_name:
        lambda_client().invoke(
            FunctionName=fn_name,
            InvocationType="Event",
            Payload=json.dumps(
                {
                    "task": "concat_chunks",
                    "session_id": session_id_value,
                    "media_type": media_type,
                    "content_type": content_type,
                    "extension": ext,
                }
            ).encode("utf-8"),
        )
        logger.info("concat triggered (async) id=%s media=%s", session_id_value, media_type)
        return {"message": "Concatenation started", "status": "processing", "media_type": media_type, "async": True}

    # Local / non-Lambda: do it inline.
    logger.info("concat running (inline) id=%s media=%s", session_id_value, media_type)
    return _run_chunk_concat(session_id_value, media_type, content_type, ext)


def run_concat_chunks_task(event: Dict[str, Any]) -> Dict[str, Any]:
    """Async worker entry (invoked by the Lambda handler for {task: concat_chunks})."""
    session_id_value = str(event.get("session_id") or "")
    media_type = str(event.get("media_type") or "")
    content_type = str(event.get("content_type") or "application/octet-stream")
    ext = str(event.get("extension") or "webm")
    logger.info("concat worker start id=%s media=%s", session_id_value, media_type)
    try:
        return _run_chunk_concat(session_id_value, media_type, content_type, ext)
    except Exception as err:  # noqa: BLE001
        logger.exception("concat_chunks task failed for %s/%s", session_id_value, media_type)
        try:
            sessions_collection().update_one(
                {"_id": session_id_value},
                {
                    "$set": {
                        f"uploads.{media_type}.status": "failed",
                        f"uploads.{media_type}.error": str(err)[:500],
                        f"uploads.{media_type}.updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                },
            )
        except Exception:
            logger.exception("Failed to record concat failure status")
        return {"status": "failed", "error": str(err)}


def _run_chunk_concat(session_id_value: str, media_type: str, content_type: str, ext: str) -> Dict[str, Any]:
    """Stream all chunks (in seq order) through an S3 multipart upload, buffering
    to the 5 MiB part minimum, so memory stays bounded regardless of recording
    length. The chunks are byte-segments of one continuous MediaRecorder stream,
    so a binary concat reproduces the original file (no transcoding)."""
    if media_type not in MEDIA_TYPES:
        raise ValueError("Invalid media_type")
    ext = (ext or "webm").strip().lower().replace(".", "") or "webm"

    cfg = settings()
    bucket = cfg["recording_bucket"]
    if not bucket:
        raise RuntimeError("RECORDING_BUCKET is not configured")

    collection = sessions_collection()
    doc = collection.find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")

    client = s3_client()
    prefix = session_media_chunk_prefix(doc, media_type)

    # Collect all chunk objects under the prefix, ordered by their numeric seq.
    chunk_keys: List[str] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            if obj.get("Key", "").endswith(".part"):
                chunk_keys.append(obj["Key"])
    chunk_keys.sort()  # zero-padded seq names sort lexicographically == numerically
    if not chunk_keys:
        raise FileNotFoundError(f"No uploaded chunks found for {media_type}")

    final_key = session_media_key(doc, media_type, ext)
    create = client.create_multipart_upload(Bucket=bucket, Key=final_key, ContentType=content_type)
    upload_id = create.get("UploadId", "")
    if not upload_id:
        raise RuntimeError("Failed to initialize concat multipart upload")

    parts: List[Dict[str, Any]] = []
    part_number = 1
    buffer = bytearray()
    total_bytes = 0

    def _flush(force: bool) -> None:
        nonlocal buffer, part_number
        if not buffer:
            return
        if not force and len(buffer) < CHUNK_CONCAT_PART_BYTES:
            return
        resp = client.upload_part(
            Bucket=bucket,
            Key=final_key,
            UploadId=upload_id,
            PartNumber=part_number,
            Body=bytes(buffer),
        )
        parts.append({"ETag": resp["ETag"], "PartNumber": part_number})
        part_number += 1
        buffer = bytearray()

    try:
        for key in chunk_keys:
            body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
            total_bytes += len(body)
            buffer.extend(body)
            _flush(force=False)
        _flush(force=True)

        if not parts:
            raise RuntimeError("Nothing to concatenate (all chunks empty)")

        client.complete_multipart_upload(
            Bucket=bucket,
            Key=final_key,
            UploadId=upload_id,
            MultipartUpload={"Parts": parts},
        )
    except Exception:
        try:
            client.abort_multipart_upload(Bucket=bucket, Key=final_key, UploadId=upload_id)
        except Exception:  # best effort
            logger.exception("Failed to abort concat multipart for %s", final_key)
        raise

    # Best-effort cleanup of the now-redundant chunk objects.
    try:
        for i in range(0, len(chunk_keys), 1000):
            client.delete_objects(
                Bucket=bucket,
                Delete={"Objects": [{"Key": k} for k in chunk_keys[i : i + 1000]]},
            )
    except Exception:
        logger.exception("Failed to clean up chunk objects under %s", prefix)

    object_url = f"https://{bucket}.s3.{cfg['aws_region']}.amazonaws.com/{final_key}"
    collection.update_one(
        {"_id": session_id_value},
        {
            "$set": {
                f"uploads.{media_type}": {
                    "key": final_key,
                    "content_type": content_type,
                    "object_url": object_url,
                    "status": "completed",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    logger.info(
        "concat complete id=%s media=%s chunks=%d parts=%d bytes=%d key=%s",
        session_id_value, media_type, len(chunk_keys), len(parts), total_bytes, final_key,
    )
    _record_activity(doc, "recording_finalized", meta={
        "session_id": session_id_value, "media_type": media_type,
        "chunks": len(chunk_keys), "bytes": total_bytes, "key": final_key,
    })
    return {
        "message": "Chunks concatenated",
        "media_type": media_type,
        "key": final_key,
        "object_url": object_url,
        "chunks": len(chunk_keys),
        "parts": len(parts),
        "bytes": total_bytes,
    }


# A recording with no heartbeat for this long is considered abandoned (closed tab,
# crash, network loss) and is auto-finalized by the reaper.
SESSION_HEARTBEAT_STALE_SECONDS = 5 * 60


def record_session_heartbeat_payload(session_id_value: str) -> Dict[str, Any]:
    """Bump last_heartbeat so the reaper knows the recorder is still alive."""
    now_iso = datetime.now(timezone.utc).isoformat()
    res = sessions_collection().update_one(
        {"_id": session_id_value, "doc_type": "study_session"},
        {"$set": {"last_heartbeat": now_iso}},
    )
    if res.matched_count == 0:
        raise LookupError("Session not found")
    logger.debug("heartbeat id=%s", session_id_value)
    return {"message": "ok", "at": now_iso}


def _media_has_chunks(bucket: str, doc: Dict[str, Any], media_type: str) -> bool:
    prefix = session_media_chunk_prefix(doc, media_type)
    resp = s3_client().list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=1)
    return resp.get("KeyCount", 0) > 0


def _finalize_abandoned_session(doc: Dict[str, Any], reason: str) -> None:
    """Salvage an abandoned recording: concat whatever chunks reached S3 (a clean
    truncated-at-outage prefix) and mark the session stopped."""
    sid = doc.get("_id")
    bucket = settings()["recording_bucket"]
    now_iso = datetime.now(timezone.utc).isoformat()
    collection = sessions_collection()
    logger.info("finalizing abandoned session id=%s reason=%s", sid, reason)

    if bucket:
        for media_type in MEDIA_TYPES:
            try:
                if _media_has_chunks(bucket, doc, media_type):
                    content_type = "audio/webm" if media_type == "audio" else "video/webm"
                    _trigger_media_concat(sid, media_type, content_type, "webm")
            except Exception:
                logger.exception("Salvage concat failed for %s on %s", media_type, sid)

    elapsed = max(0, int(doc.get("elapsed_seconds", 0) or 0))
    collection.update_one(
        {"_id": sid},
        {
            "$set": {
                "status": "stopped",
                "stopped_at": now_iso,
                "total_time_minutes": max(0, (elapsed + 59) // 60),
                "updated_at": now_iso,
            },
            "$push": {"events": {"status": "stopped", "elapsed_seconds": elapsed, "at": now_iso, "reason": reason}},
        },
    )
    _record_activity(doc, "recording_auto_stopped", duration_minutes=(elapsed // 60), meta={
        "session_id": sid, "reason": reason,
    })


def reap_stale_sessions(user_id: str | None = None) -> Dict[str, Any]:
    """Find recordings stuck active with a stale/missing heartbeat and finalize them.

    Runs best-effort on the sessions-list call (so a user's own abandoned session is
    cleaned when they return) and can also be invoked on a schedule (EventBridge ->
    {task: reap_stale}) to close sessions even if the user never comes back."""
    collection = sessions_collection()
    cutoff = datetime.now(timezone.utc).timestamp() - SESSION_HEARTBEAT_STALE_SECONDS
    query: Dict[str, Any] = {"doc_type": "study_session", "status": {"$in": ["started", "resumed", "paused"]}}
    if user_id:
        query["user_id"] = user_id

    reaped = []
    for doc in collection.find(query):
        # Reference time: last heartbeat, else when it started/was created.
        ref = doc.get("last_heartbeat") or doc.get("started_at") or doc.get("created_at") or ""
        try:
            ref_ts = datetime.fromisoformat(str(ref)).timestamp() if ref else 0
        except Exception:
            ref_ts = 0
        if ref_ts and ref_ts > cutoff:
            continue  # still alive
        try:
            _finalize_abandoned_session(doc, "auto_stopped_stale_heartbeat")
            reaped.append(doc.get("_id"))
        except Exception:
            logger.exception("Failed to reap stale session %s", doc.get("_id"))
    if reaped:
        logger.info("reaper finalized %d stale session(s): %s", len(reaped), reaped)
    return {"reaped": reaped, "count": len(reaped)}


def update_session_notes_payload(session_id_value: str, payload) -> Dict[str, Any]:
    collection = sessions_collection()
    doc = collection.find_one({"_id": session_id_value, "doc_type": "study_session"})
    if not doc:
        raise LookupError("Session not found")
    notes = (payload.notes or "").strip()
    collection.update_one(
        {"_id": session_id_value},
        {"$set": {"notes": notes, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    updated = collection.find_one({"_id": session_id_value})
    logger.info("session notes updated id=%s len=%d", session_id_value, len(notes))
    return {"message": "Notes updated", "session": updated}


def create_presigned_playback_url_payload(
    session_id_value: str, media_type: str, disposition: str | None = None
) -> Dict[str, Any]:
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

    params = {"Bucket": bucket, "Key": key}
    # Force a download (Content-Disposition: attachment) so the browser saves the
    # file instead of opening/streaming it in a new tab.
    if disposition == "attachment":
        ext = key.rsplit(".", 1)[-1] if "." in key else "webm"
        base = "-".join(p for p in [doc.get("subject", ""), doc.get("topic", ""), media_type] if p) or "recording"
        safe = "".join(c if (c.isalnum() or c in "-_") else "_" for c in base)[:80]
        params["ResponseContentDisposition"] = f'attachment; filename="{safe}.{ext}"'

    playback_url = client.generate_presigned_url("get_object", Params=params, ExpiresIn=3600)
    logger.info(
        "presigned %s url id=%s media=%s key=%s",
        "download" if disposition == "attachment" else "playback", session_id_value, media_type, key,
    )
    return {"playback_url": playback_url, "media_type": media_type, "key": key}
