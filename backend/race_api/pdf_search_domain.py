from __future__ import annotations

from datetime import datetime, timezone
import json
import re
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from typing import Any, Dict, List

from pymongo import ASCENDING, DESCENDING

from .context import (
    current_date_str,
    goals_collection,
    logger,
    pdf_docs_collection,
    pdf_pages_collection,
    s3_client,
    sanitize_key_part,
    settings,
    storage_client,
    textract_client,
)

_pdf_indexes_ensured = False
COURSE_OPTIONS = {
    "sfg_level_1": "SFG Level 1",
    "sfg_level_2": "SFG Level 2",
    "level_up_pmp": "Level Up PMP",
    "spectrum": "Spectrum",
    "laxmikant": "Laxmikant",
}


def _ensure_pdf_indexes() -> None:
    global _pdf_indexes_ensured
    if _pdf_indexes_ensured:
        return

    docs = pdf_docs_collection()
    docs.create_index([("doc_id", ASCENDING)], unique=True)
    docs.create_index([("updated_at", DESCENDING)])

    pages = pdf_pages_collection()
    pages.create_index([("doc_id", ASCENDING), ("page_number", ASCENDING)], unique=True)
    pages.create_index([("doc_id", ASCENDING)])
    pages.create_index([("course", ASCENDING)])
    pages.create_index([("embedding_ready", ASCENDING)])

    _pdf_indexes_ensured = True


def _pdf_bucket() -> str:
    bucket = settings()["pdf_search_bucket"]
    if not bucket:
        raise RuntimeError("PDF_SEARCH_BUCKET or RECORDING_BUCKET is not configured")
    return bucket


def _pdf_key(doc_id: str, file_name: str, user_id: str = "") -> str:
    cfg = settings()
    prefix = (cfg.get("pdf_search_prefix") or "pdf-search").strip("/")
    date_part = current_date_str()
    safe_name = sanitize_key_part(file_name or "document.pdf")
    if not safe_name.lower().endswith(".pdf"):
        safe_name = f"{safe_name}.pdf"
    uid = sanitize_key_part(user_id or "")
    if uid:
        return f"{prefix}/{uid}/{date_part}/{doc_id}/{safe_name}"
    return f"{prefix}/{date_part}/{doc_id}/{safe_name}"


def _stage_for_textract(
    doc_id: str, source_bucket: str, source_key: str, file_name: str, user_id: str
) -> tuple[str, str]:
    """Textract and the search-result viewer read from AWS S3 only. When the source
    PDF lives in a different bucket (e.g. Backblaze B2 content storage), copy it into
    the AWS pdf-search bucket and return that (bucket, key). If it is already in the
    pdf-search bucket, return it unchanged."""
    target_bucket = _pdf_bucket()
    if source_bucket == target_bucket:
        return source_bucket, source_key
    body = storage_client().get_object(Bucket=source_bucket, Key=source_key)["Body"].read()
    target_key = _pdf_key(doc_id, file_name, user_id)
    s3_client().put_object(
        Bucket=target_bucket, Key=target_key, Body=body, ContentType="application/pdf"
    )
    return target_bucket, target_key


GLOBAL_COURSE = "global"


def _normalize_course(course: str | None) -> str:
    """Normalise a course selector.

    A "course" is either the literal ``"global"`` (content shared across every
    goal) or a goal id. Returns the trimmed value, or ``""`` when nothing was
    provided. (Previously restricted to a fixed list of course names; any goal —
    or global — is now accepted.)
    """
    return (course or "").strip()


def _course_label(course: str | None, user_id: str = "") -> str:
    """Human-readable label for a course selector, for display in results."""
    c = (course or "").strip()
    if not c or c == GLOBAL_COURSE:
        return "Global (all goals)"
    if c in COURSE_OPTIONS:  # legacy fixed-course keys, if any remain indexed
        return COURSE_OPTIONS[c]
    # Otherwise treat it as a goal id and resolve the goal's name.
    try:
        from bson import ObjectId

        doc = goals_collection().find_one({"_id": ObjectId(c)}, {"name": 1})
        if doc and doc.get("name"):
            return str(doc["name"])
    except Exception:  # noqa: BLE001 — label resolution is best-effort
        pass
    return c


def _doc_id() -> str:
    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"pdf:{now}:{datetime.now(timezone.utc).timestamp():.6f}".replace(".", "")


def _embedding_model() -> str:
    return (settings().get("openai_embeddings_model") or "text-embedding-3-small").strip()


def _openai_api_key() -> str:
    return (settings().get("openai_api_key") or "").strip()


def _vector_index_name() -> str:
    return (settings().get("mongodb_pdf_vector_index_name") or "pdf_embedding_index").strip()


def _page_vector_id(doc_id: str, page_number: int) -> str:
    return f"{doc_id}::{int(page_number)}"


def delete_doc_vectors(doc_ids: List[str]) -> None:
    """Remove all Upstash vectors belonging to the given PDF documents (best-effort)."""
    from . import upstash_vector as uv
    if not uv.is_configured():
        return
    for did in doc_ids:
        if did:
            uv.delete_by_filter(f"doc_id = '{uv.escape(did)}'")


def _embedding_dimensions() -> int:
    cfg = settings()
    raw = str(cfg.get("openai_embeddings_dimensions", "") or "").strip()
    if raw.isdigit():
        return int(raw)
    model = _embedding_model()
    if model == "text-embedding-3-large":
        return 3072
    return 1536


def _build_snippet_text(text: str) -> str:
    compact = re.sub(r"\s+", " ", (text or "").strip())
    if len(compact) <= 4000:
        return compact
    return compact[:4000]


def _textract_enabled() -> bool:
    value = str(settings().get("textract_enabled", "1")).strip().lower()
    return value not in {"0", "false", "no", "off"}


def _textract_poll_seconds() -> int:
    raw = str(settings().get("textract_poll_seconds", "2")).strip()
    return int(raw) if raw.isdigit() else 2


def _textract_timeout_seconds() -> int:
    raw = str(settings().get("textract_timeout_seconds", "900")).strip()
    return int(raw) if raw.isdigit() else 900


def _embed_text_batch(texts: List[str]) -> List[List[float]]:
    api_key = _openai_api_key()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    payload = json.dumps(
        {
            "model": _embedding_model(),
            "input": texts,
            "dimensions": _embedding_dimensions(),
        }
    ).encode("utf-8")

    request = Request(
        "https://api.openai.com/v1/embeddings",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"OpenAI embeddings failed: HTTP {err.code} {detail}") from err
    except URLError as err:
        raise RuntimeError(f"OpenAI embeddings failed: {err.reason}") from err

    parsed = json.loads(body)
    data = parsed.get("data", [])
    vectors = [item.get("embedding", []) for item in data]
    if len(vectors) != len(texts):
        raise RuntimeError("Embedding response size mismatch")
    tokens = int((parsed.get("usage") or {}).get("total_tokens", 0) or 0)
    return vectors, tokens


def _embed_texts(texts: List[str], batch_size: int = 64) -> List[List[float]]:
    vectors: List[List[float]] = []
    for start in range(0, len(texts), batch_size):
        chunk = texts[start:start + batch_size]
        vecs, _tokens = _embed_text_batch(chunk)
        vectors.extend(vecs)
    return vectors


def _try_create_vector_index() -> None:
    coll = pdf_pages_collection()
    db = coll.database
    index_name = _vector_index_name()
    definition = {
        "fields": [
            {
                "type": "vector",
                "path": "embedding",
                "numDimensions": _embedding_dimensions(),
                "similarity": "cosine",
            },
            {
                "type": "filter",
                "path": "course",
            },
            {
                "type": "filter",
                "path": "user_id",
            },
        ]
    }

    update_command = {
        "updateSearchIndex": coll.name,
        "name": index_name,
        "definition": definition,
    }
    create_command = {
        "createSearchIndexes": coll.name,
        "indexes": [
            {
                "name": index_name,
                "type": "vectorSearch",
                "definition": definition,
            }
        ],
    }
    try:
        db.command(update_command)
    except Exception:  # noqa: BLE001
        try:
            db.command(create_command)
        except Exception:
            # Keep index management best-effort.
            return


def create_pdf_presigned_upload(payload, user_id: str = "") -> Dict[str, Any]:
    from .storage_domain import assert_storage_available

    assert_storage_available(user_id, 0)
    _ensure_pdf_indexes()
    file_name = (payload.file_name or "").strip()
    if not file_name:
        raise ValueError("file_name is required")
    content_type = (payload.content_type or "application/pdf").strip().lower()
    if "pdf" not in content_type:
        raise ValueError("Only PDF uploads are allowed")
    course = _normalize_course(payload.course)
    if not course:
        raise ValueError("course is required (select a goal, or 'global')")
    course_label = _course_label(course, user_id)

    doc_id = _doc_id()
    key = _pdf_key(doc_id, file_name, user_id)
    bucket = _pdf_bucket()

    upload_url = s3_client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": bucket,
            "Key": key,
            "ContentType": "application/pdf",
        },
        ExpiresIn=3600,
    )

    pdf_docs_collection().update_one(
        {"doc_id": doc_id},
        {
            "$set": {
                "doc_id": doc_id,
                "file_name": file_name,
                "bucket": bucket,
                "key": key,
                "course": course,
                "course_label": course_label,
                "status": "uploaded_pending_index",
                "page_count": 0,
                "user_id": (user_id or "").strip(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        },
        upsert=True,
    )

    return {
        "doc_id": doc_id,
        "bucket": bucket,
        "key": key,
        "course": course,
        "course_label": course_label,
        "upload_url": upload_url,
    }


def _extract_pdf_pages_from_textract(bucket: str, key: str) -> List[Dict[str, Any]]:
    if not _textract_enabled():
        raise RuntimeError("TEXTRACT_ENABLED is off, cannot OCR/index PDFs")

    client = textract_client()
    start_resp = client.start_document_text_detection(
        DocumentLocation={"S3Object": {"Bucket": bucket, "Name": key}}
    )
    job_id = start_resp.get("JobId")
    if not job_id:
        raise RuntimeError("Textract start_document_text_detection did not return JobId")

    started_at = time.time()
    timeout_seconds = max(30, _textract_timeout_seconds())
    poll_seconds = max(1, _textract_poll_seconds())

    status = "IN_PROGRESS"
    page_lines: Dict[int, List[Dict[str, Any]]] = {}

    while status == "IN_PROGRESS":
        if time.time() - started_at > timeout_seconds:
            raise RuntimeError(
                f"Textract job timed out in {timeout_seconds}s. "
                "Increase TEXTRACT_TIMEOUT_SECONDS or split file."
            )

        response = client.get_document_text_detection(JobId=job_id)
        status = response.get("JobStatus", "IN_PROGRESS")
        if status == "IN_PROGRESS":
            time.sleep(poll_seconds)
            continue

        if status not in {"SUCCEEDED", "PARTIAL_SUCCESS"}:
            raise RuntimeError(f"Textract failed with status: {status}")

        next_token = None
        while True:
            current = response if next_token is None else client.get_document_text_detection(JobId=job_id, NextToken=next_token)
            blocks = current.get("Blocks", []) or []
            for block in blocks:
                if block.get("BlockType") != "LINE":
                    continue
                page_number = int(block.get("Page", 1) or 1)
                text = (block.get("Text") or "").strip()
                if not text:
                    continue
                bbox = (block.get("Geometry", {}) or {}).get("BoundingBox", {}) or {}
                top = float(bbox.get("Top", 0.0) or 0.0)
                left = float(bbox.get("Left", 0.0) or 0.0)
                page_lines.setdefault(page_number, []).append({"text": text, "top": top, "left": left})

            next_token = current.get("NextToken")
            if not next_token:
                break

    pages: List[Dict[str, Any]] = []
    for page_number in sorted(page_lines.keys()):
        lines = sorted(page_lines[page_number], key=lambda item: (item["top"], item["left"]))
        merged = "\n".join(line["text"] for line in lines).strip()
        pages.append({"page_number": page_number, "text": merged})
    return pages


def index_pdf_document(payload) -> Dict[str, Any]:
    _ensure_pdf_indexes()
    doc_id = (payload.doc_id or "").strip()
    if not doc_id:
        raise ValueError("doc_id is required")

    doc = pdf_docs_collection().find_one({"doc_id": doc_id})
    if not doc:
        raise LookupError("PDF document metadata not found")

    source_bucket = doc.get("bucket") or _pdf_bucket()
    source_key = doc.get("key")
    course = _normalize_course(doc.get("course"))
    doc_user_id = str(doc.get("user_id", "") or "").strip()
    if not course:
        raise ValueError("Document course metadata is missing")
    # Prefer the label captured at request time; otherwise resolve it once here
    # (avoids a goal lookup per page/vector below).
    course_label = doc.get("course_label") or _course_label(course, doc_user_id)
    if not source_key:
        raise ValueError("PDF key missing for this document")

    # Textract can only read from AWS S3. Content uploaded to Backblaze B2 must be
    # staged into the AWS pdf-search bucket first; the staged (bucket, key) is what
    # OCR, size tracking, and the search-result viewer all use from here on.
    bucket, key = _stage_for_textract(
        doc_id, source_bucket, source_key, doc.get("file_name") or "document.pdf", doc_user_id
    )
    if (bucket, key) != (source_bucket, source_key):
        pdf_docs_collection().update_one(
            {"doc_id": doc_id}, {"$set": {"bucket": bucket, "key": key}}
        )

    # Record the file size for the storage quota (delta over any previously-counted size).
    try:
        prev_size = int(doc.get("size", 0) or 0)
        new_size = int(s3_client().head_object(Bucket=bucket, Key=key).get("ContentLength", 0) or 0)
        if new_size != prev_size:
            pdf_docs_collection().update_one({"doc_id": doc_id}, {"$set": {"size": new_size}})
            from .storage_domain import incr_storage
            incr_storage(doc_user_id, new_size - prev_size)
    except Exception:
        logger.exception("pdf size/usage tracking failed")

    pages = _extract_pdf_pages_from_textract(bucket, key)

    from . import upstash_vector as uv
    if not uv.is_configured():
        raise RuntimeError("Upstash Vector is not configured (UPSTASH_VECTOR_REST_URL / _TOKEN)")
    if not _openai_api_key():
        raise RuntimeError("OPENAI_API_KEY is required for vector indexing")

    pages_coll = pdf_pages_collection()
    pages_coll.delete_many({"doc_id": doc_id})
    # Drop any stale vectors for this doc before re-indexing.
    uv.delete_by_filter(f"doc_id = '{uv.escape(doc_id)}'")

    to_embed = []
    vector_indices: List[int] = []
    for idx, p in enumerate(pages):
        snippet = _build_snippet_text(p.get("text", ""))
        if snippet:
            to_embed.append(snippet)
            vector_indices.append(idx)
    embedding_vectors: List[List[float]] = _embed_texts(to_embed) if to_embed else []

    if pages:
        embedding_map: Dict[int, List[float]] = {}
        for pos, page_idx in enumerate(vector_indices):
            embedding_map[page_idx] = embedding_vectors[pos]

        # Mongo keeps page text (for management/deletion + display); vectors live in Upstash.
        rows = [
            {
                "doc_type": "pdf_page",
                "doc_id": doc_id,
                "file_name": doc.get("file_name", ""),
                "bucket": bucket,
                "key": key,
                "course": course,
                "course_label": course_label,
                "user_id": doc_user_id,
                "page_number": p["page_number"],
                "text": p["text"],
                "embedding_ready": i in embedding_map,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            for i, p in enumerate(pages)
        ]
        pages_coll.insert_many(rows)

        # Upsert page vectors to Upstash with the metadata needed to render results.
        vectors = []
        for page_idx, vec in embedding_map.items():
            p = pages[page_idx]
            vectors.append({
                "id": _page_vector_id(doc_id, p["page_number"]),
                "vector": vec,
                "metadata": {
                    "doc_id": doc_id,
                    "user_id": doc_user_id,
                    "course": course,
                    "course_label": course_label,
                    "file_name": doc.get("file_name", ""),
                    "bucket": bucket,
                    "key": key,
                    "page_number": p["page_number"],
                    "text": p.get("text", ""),
                },
            })
        for start in range(0, len(vectors), 100):
            uv.upsert(vectors[start:start + 100])

    pdf_docs_collection().update_one(
        {"doc_id": doc_id},
        {
            "$set": {
                "status": "indexed_with_vectors",
                "page_count": len(pages),
                "ocr_engine": "aws_textract",
                "course": course,
                "course_label": course_label,
                "vector_index_name": _vector_index_name(),
                "embedding_model": _embedding_model(),
                "vector_ready_pages": len(embedding_vectors),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )

    return {
        "message": "PDF indexed",
        "doc_id": doc_id,
        "page_count": len(pages),
        "course": course,
        "course_label": course_label,
        "vector_enabled": True,
        "vector_ready_pages": len(embedding_vectors),
    }


def _snippet(text: str, query: str) -> str:
    if not text:
        return ""
    q = (query or "").strip().lower()
    low = text.lower()
    at = low.find(q) if q else -1
    if at < 0:
        return text[:240]
    start = max(0, at - 70)
    end = min(len(text), at + len(q) + 140)
    return text[start:end]


def search_pdf(query: str, limit: int = 20, course: str | None = None, user_id: str = "", track_search: bool = False, include_text: bool = False) -> Dict[str, Any]:
    _ensure_pdf_indexes()
    q = (query or "").strip()
    if not q:
        raise ValueError("query is required")

    lim = max(1, min(int(limit or 20), 100))
    # A course is a goal id or "global"; empty / "global" means search everything.
    selected_course = _normalize_course(course)
    uid = (user_id or "").strip()

    if not _openai_api_key():
        raise RuntimeError("OPENAI_API_KEY is required for vector search")

    _qvecs, _embed_tokens = _embed_text_batch([q])
    query_vector = _qvecs[0]
    if track_search and uid:
        try:
            from .storage_domain import add_llm_tokens
            add_llm_tokens(uid, "search", _embed_tokens)
        except Exception:
            logger.exception("usage add_llm_tokens (search) failed")
    from . import upstash_vector as uv
    if not uv.is_configured():
        raise RuntimeError("Upstash Vector is not configured (UPSTASH_VECTOR_REST_URL / _TOKEN)")

    # Metadata filter: always scope to the user; optionally to a course.
    # A specific goal also surfaces content indexed as "global" (all goals).
    clauses = []
    if uid:
        clauses.append(f"user_id = '{uv.escape(uid)}'")
    if selected_course and selected_course != GLOBAL_COURSE:
        clauses.append(
            f"(course = '{uv.escape(selected_course)}' OR course = '{GLOBAL_COURSE}')"
        )
    flt = " AND ".join(clauses) if clauses else None

    matches = uv.query(query_vector, top_k=lim, flt=flt, include_metadata=True)

    url_cache: Dict[str, str] = {}
    result_rows = []
    for m in matches:
        md = m.get("metadata") or {}
        key = md.get("key", "")
        bucket = md.get("bucket") or _pdf_bucket()
        cache_key = f"{bucket}::{key}"
        if key and cache_key not in url_cache:
            url_cache[cache_key] = s3_client().generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=3600,
            )
        text = md.get("text", "")
        result_row = {
            "doc_id": md.get("doc_id", ""),
            "file_name": md.get("file_name", ""),
            "course": md.get("course", ""),
            "course_label": md.get("course_label", md.get("course", "")),
            "page_number": int(md.get("page_number", 1) or 1),
            "snippet": _snippet(text, q),
            "pdf_url": url_cache.get(cache_key, ""),
            "score": m.get("score"),
        }
        if include_text:
            # Full page text for grounding (QnA); callers that only display snippets omit this.
            result_row["text"] = text
        result_rows.append(result_row)

    return {
        "query": q,
        "course": selected_course or "global",
        "search_mode": "upstash_vector",
        "count": len(result_rows),
        "results": result_rows,
    }
