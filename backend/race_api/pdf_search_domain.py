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
    pdf_docs_collection,
    pdf_pages_collection,
    s3_client,
    sanitize_key_part,
    settings,
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


def _pdf_key(doc_id: str, file_name: str) -> str:
    cfg = settings()
    prefix = (cfg.get("pdf_search_prefix") or "pdf-search").strip("/")
    date_part = current_date_str()
    safe_name = sanitize_key_part(file_name or "document.pdf")
    if not safe_name.lower().endswith(".pdf"):
        safe_name = f"{safe_name}.pdf"
    return f"{prefix}/{date_part}/{doc_id}/{safe_name}"


def _normalize_course(course: str | None) -> str:
    raw = (course or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "sfg1": "sfg_level_1",
        "sfg_1": "sfg_level_1",
        "sfg_level_1": "sfg_level_1",
        "sfg2": "sfg_level_2",
        "sfg_2": "sfg_level_2",
        "sfg_level_2": "sfg_level_2",
        "leveluppmp": "level_up_pmp",
        "level_up_pmp": "level_up_pmp",
        "pmp": "level_up_pmp",
        "spectrum": "spectrum",
        "laxmikant": "laxmikant",
    }
    return aliases.get(raw, "")


def _doc_id() -> str:
    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"pdf:{now}:{datetime.now(timezone.utc).timestamp():.6f}".replace(".", "")


def _embedding_model() -> str:
    return (settings().get("openai_embeddings_model") or "text-embedding-3-small").strip()


def _openai_api_key() -> str:
    return (settings().get("openai_api_key") or "").strip()


def _vector_index_name() -> str:
    return (settings().get("mongodb_pdf_vector_index_name") or "pdf_embedding_index").strip()


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
    return vectors


def _embed_texts(texts: List[str], batch_size: int = 64) -> List[List[float]]:
    vectors: List[List[float]] = []
    for start in range(0, len(texts), batch_size):
        chunk = texts[start:start + batch_size]
        vectors.extend(_embed_text_batch(chunk))
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


def create_pdf_presigned_upload(payload) -> Dict[str, Any]:
    _ensure_pdf_indexes()
    file_name = (payload.file_name or "").strip()
    if not file_name:
        raise ValueError("file_name is required")
    content_type = (payload.content_type or "application/pdf").strip().lower()
    if "pdf" not in content_type:
        raise ValueError("Only PDF uploads are allowed")
    course = _normalize_course(payload.course)
    if not course:
        allowed = ", ".join(COURSE_OPTIONS.values())
        raise ValueError(f"course is required and must be one of: {allowed}")

    doc_id = _doc_id()
    key = _pdf_key(doc_id, file_name)
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
                "course_label": COURSE_OPTIONS[course],
                "status": "uploaded_pending_index",
                "page_count": 0,
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
        "course_label": COURSE_OPTIONS[course],
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

    bucket = doc.get("bucket") or _pdf_bucket()
    key = doc.get("key")
    course = _normalize_course(doc.get("course"))
    if not course:
        raise ValueError("Document course metadata is missing")
    if not key:
        raise ValueError("PDF key missing for this document")

    pages = _extract_pdf_pages_from_textract(bucket, key)

    pages_coll = pdf_pages_collection()
    pages_coll.delete_many({"doc_id": doc_id})

    if not _openai_api_key():
        raise RuntimeError("OPENAI_API_KEY is required for vector indexing")

    _try_create_vector_index()

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

        rows = [
            {
                "doc_type": "pdf_page",
                "doc_id": doc_id,
                "file_name": doc.get("file_name", ""),
                "bucket": bucket,
                "key": key,
                "course": course,
                "course_label": COURSE_OPTIONS.get(course, course),
                "page_number": p["page_number"],
                "text": p["text"],
                "embedding": embedding_map.get(i),
                "embedding_ready": i in embedding_map,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            for i, p in enumerate(pages)
        ]
        pages_coll.insert_many(rows)

    pdf_docs_collection().update_one(
        {"doc_id": doc_id},
        {
            "$set": {
                "status": "indexed_with_vectors",
                "page_count": len(pages),
                "ocr_engine": "aws_textract",
                "course": course,
                "course_label": COURSE_OPTIONS.get(course, course),
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
        "course_label": COURSE_OPTIONS.get(course, course),
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


def search_pdf(query: str, limit: int = 20, course: str | None = None) -> Dict[str, Any]:
    _ensure_pdf_indexes()
    _try_create_vector_index()
    q = (query or "").strip()
    if not q:
        raise ValueError("query is required")

    lim = max(1, min(int(limit or 20), 100))
    coll = pdf_pages_collection()
    selected_course = _normalize_course(course)
    if course and not selected_course:
        allowed = ", ".join(COURSE_OPTIONS.values())
        raise ValueError(f"course must be one of: {allowed}")

    if not _openai_api_key():
        raise RuntimeError("OPENAI_API_KEY is required for vector search")

    query_vector = _embed_text_batch([q])[0]
    vector_stage: Dict[str, Any] = {
        "index": _vector_index_name(),
        "path": "embedding",
        "queryVector": query_vector,
        "numCandidates": max(100, lim * 15),
        "limit": lim,
    }
    if selected_course:
        vector_stage["filter"] = {"course": selected_course}

    try:
        rows: List[Dict[str, Any]] = list(
            coll.aggregate(
                [
                    {
                        "$vectorSearch": vector_stage
                    },
                    {
                        "$project": {
                            "_id": 0,
                            "doc_id": 1,
                            "file_name": 1,
                            "bucket": 1,
                            "key": 1,
                            "course": 1,
                            "course_label": 1,
                            "page_number": 1,
                            "text": 1,
                            "score": {"$meta": "vectorSearchScore"},
                        }
                    },
                ]
            )
        )
    except Exception as err:  # noqa: BLE001
        message = str(err)
        if "needs to be indexed as filter" in message and "course" in message:
            raise RuntimeError(
                "Vector index is stale. Update Atlas index "
                f"'{_vector_index_name()}' with filter field 'course' and vector field "
                f"'embedding' (numDimensions={_embedding_dimensions()})."
            ) from err
        raise

    url_cache: Dict[str, str] = {}
    result_rows = []
    for row in rows:
        key = row.get("key", "")
        bucket = row.get("bucket") or _pdf_bucket()
        cache_key = f"{bucket}::{key}"
        if cache_key not in url_cache:
            url_cache[cache_key] = s3_client().generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=3600,
            )
        pdf_url = url_cache[cache_key]
        result_rows.append(
            {
                "doc_id": row.get("doc_id", ""),
                "file_name": row.get("file_name", ""),
                "course": row.get("course", ""),
                "course_label": row.get("course_label", row.get("course", "")),
                "page_number": int(row.get("page_number", 1) or 1),
                "snippet": _snippet(row.get("text", ""), q),
                "pdf_url": pdf_url,
            }
        )

    return {
        "query": q,
        "course": selected_course or "global",
        "search_mode": "vector",
        "count": len(result_rows),
        "results": result_rows,
    }
