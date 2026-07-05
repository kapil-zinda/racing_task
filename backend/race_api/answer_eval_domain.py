"""UPSC Mains answer evaluation.

The candidate uploads an answer PDF; the backend reads the question + answer
(typed text via pypdf, or handwriting via Textract OCR), evaluates it like a real
Mains examiner with an LLM (strict marks + breakdown + margin comments), and writes
those comments and marks back onto the PDF as annotations. Long jobs run async on
Lambda (self-invoke), inline off Lambda.
"""

import io
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pymongo import ReturnDocument

from .agent_v2_chat_domain import _chat_model, _openai_client
from .context import (
    answer_evaluations_collection,
    current_lambda_function_name,
    lambda_client,
    logger,
    s3_client,
    sanitize_key_part,
    settings,
)

MAX_TEXT_CHARS = 18000          # cap prompt size
MIN_CHARS_PER_PAGE = 40         # below this we assume scanned/handwritten -> OCR
INK = "1 0 0 rg"                # examiner red ink (PDF fill colour operator)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bucket() -> str:
    b = settings()["pdf_search_bucket"]
    if not b:
        raise RuntimeError("PDF_SEARCH_BUCKET / RECORDING_BUCKET is not configured")
    return b


def _eval_key(user_id: str, eval_id: str, name: str) -> str:
    uid = sanitize_key_part(user_id or "anon")
    return f"answer-evaluations/{uid}/{eval_id}/{name}"


# ── Text extraction ──────────────────────────────────────────────────────────
def _extract_pages_text(pdf_bytes: bytes, bucket: str, key: str) -> List[str]:
    from pypdf import PdfReader

    pages: List[str] = []
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        for page in reader.pages:
            pages.append((page.extract_text() or "").strip())
    except Exception:
        logger.exception("pypdf text extraction failed")
        pages = []

    total = sum(len(p) for p in pages)
    if pages and total >= MIN_CHARS_PER_PAGE * len(pages):
        return pages

    # Sparse/empty text -> likely handwritten/scanned. Try Textract OCR.
    try:
        from .pdf_search_domain import _extract_pdf_pages_from_textract

        ocr = _extract_pdf_pages_from_textract(bucket, key)
        if ocr:
            logger.info("answer-eval used Textract OCR (%d pages) for %s", len(ocr), key)
            return [str(p.get("text", "") or "") for p in ocr]
    except Exception:
        logger.exception("answer-eval Textract OCR failed for %s", key)
    return pages


# ── LLM evaluation ─────────────────────────────────────────────────────────--
_EVAL_SCHEMA = (
    'Return ONLY JSON: {'
    '"questions": [{'
    '"question_text": "<the question, detected or given>",'
    '"max_marks": <int>,'
    '"awarded_marks": <number>,'
    '"breakdown": {"content": "<x/total>", "structure": "<x/total>", "examples": "<x/total>", "presentation": "<x/total>"},'
    '"comments": [{"page": <1-based int>, "tag": "good|missing|improve", "text": "<short margin comment>"}],'
    '"points_missed": ["<key dimension/example the answer should have had>"]'
    '}],'
    '"total_awarded": <number>, "total_max": <int>,'
    '"overall_remark": "<2-4 sentence examiner remark>",'
    '"strengths": ["..."], "improvements": ["..."]'
    '}'
)


def _evaluate_with_llm(pages: List[str], question: str, max_marks: int) -> Dict[str, Any]:
    joined = "\n\n".join(f"[Page {i + 1}]\n{t}" for i, t in enumerate(pages) if t).strip()
    joined = joined[:MAX_TEXT_CHARS] or "(no readable text extracted)"

    system = (
        "You are a senior UPSC Civil Services Mains examiner. Evaluate the candidate's answer EXACTLY like a real "
        "examiner — strict and realistic (Mains averages roughly 45–55%). Reward: clear intro–body–conclusion structure, "
        "multi-dimensional coverage, directive compliance (analyse/examine/critically/discuss), relevant examples, data, "
        "committee/report/article references, and apt diagrams or flowcharts. Penalise: vagueness, unsubstantiated claims, "
        "missing dimensions, one-sidedness, poor structure, and word-limit violations. Marks must be granular and honest.\n\n"
        "Write the margin comments the way an examiner pens them: short, specific, actionable (e.g. 'Good — links to NITI "
        "Aayog', 'Missing: federalism dimension', 'Add a recent example', 'Conclusion too generic'). Tag each comment "
        "good/missing/improve and the page it belongs to.\n\n" + _EVAL_SCHEMA
    )
    hint = ""
    if question.strip():
        hint += f"The question is: {question.strip()}\n"
    if max_marks:
        hint += f"Total marks for this submission: {max_marks}.\n"
    else:
        hint += "Detect the question(s) and their mark allotment (UPSC questions are usually 10 or 15 markers).\n"
    user = f"{hint}\nCandidate answer (page-numbered, OCR/extracted):\n{joined}"

    client = _openai_client()
    resp = client.chat.completions.create(
        model=_chat_model(),
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    raw = (resp.choices[0].message.content or "").strip()
    try:
        return json.loads(raw)
    except Exception:
        logger.warning("answer-eval LLM returned non-JSON")
        return {"overall_remark": raw[:1500], "questions": [], "total_awarded": 0, "total_max": max_marks or 0}


# ── PDF marking — draw real red-ink text onto the page content ────────────────
# We draw into the page content stream (not annotations): annotation appearance
# streams aren't regenerated by Chrome/Preview, which is why FreeText showed as
# empty boxes. Baked-in text renders everywhere as red examiner ink, no boxes.
_UNI_TO_ASCII = {
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", "…": "...", " ": " ", "₹": "Rs ",
}


def _pdf_escape(text: str) -> str:
    out = []
    for ch in text:
        ch = _UNI_TO_ASCII.get(ch, ch)
        for c in ch:
            if c in "()\\":
                out.append("\\" + c)
            elif 32 <= ord(c) < 127:
                out.append(c)
            else:
                out.append(" ")
    return "".join(out)


def _wrap(text: str, max_chars: int) -> List[str]:
    words = (text or "").split()
    lines: List[str] = []
    cur = ""
    for w in words:
        if len(cur) + len(w) + 1 <= max_chars:
            cur = (cur + " " + w).strip()
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def _text_block(x: float, y_top: float, size: int, lines: List[str]) -> str:
    leading = size + 3
    ops = ["q", INK, "BT", f"/F1 {size} Tf", f"{leading} TL", f"{x:.1f} {y_top:.1f} Td"]
    for i, ln in enumerate(lines):
        prefix = "" if i == 0 else "T* "
        ops.append(f"{prefix}({_pdf_escape(ln)}) Tj")
    ops += ["ET", "Q"]
    return " ".join(ops)


def _append_content(writer, page_idx: int, content: str) -> None:
    from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject

    page = writer.pages[page_idx]
    if "/Resources" not in page:
        page[NameObject("/Resources")] = DictionaryObject()
    res = page[NameObject("/Resources")].get_object()
    fonts = res.get("/Font")
    if fonts is None:
        fonts = DictionaryObject()
        res[NameObject("/Font")] = fonts
    fonts = fonts.get_object()
    if "/F1" not in fonts:
        fonts[NameObject("/F1")] = DictionaryObject({
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        })
    stream = DecodedStreamObject()
    stream.set_data(("\n" + content).encode("latin-1", "replace"))
    ref = writer._add_object(stream)
    existing = page.raw_get("/Contents") if "/Contents" in page else None
    arr = ArrayObject()
    if existing is not None:
        arr.append(existing)
    arr.append(ref)
    page[NameObject("/Contents")] = arr


def _annotate_pdf(pdf_bytes: bytes, result: Dict[str, Any]) -> bytes:
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    writer.append(reader)
    n_pages = len(writer.pages)
    if n_pages == 0:
        return pdf_bytes

    dims: Dict[int, tuple] = {}
    cursors: Dict[int, float] = {}
    ops: Dict[int, List[str]] = {i: [] for i in range(n_pages)}
    for i in range(n_pages):
        box = writer.pages[i].mediabox
        dims[i] = (float(box.width), float(box.height))
        cursors[i] = dims[i][1] - 70  # start comments below the top margin

    # 1) Marks header (red) at the top of page 1.
    header = f"UPSC EVALUATION   Marks: {result.get('total_awarded')}/{result.get('total_max')}"
    qmarks = [f"Q{i + 1}: {q.get('awarded_marks')}/{q.get('max_marks')}" for i, q in enumerate(result.get("questions", []) or [])]
    if qmarks:
        header += "   (" + ", ".join(qmarks) + ")"
    w0, h0 = dims[0]
    ops[0].append(_text_block(28, h0 - 32, 11, _wrap(header, max(20, int((w0 - 56) / 5.5)))))

    # 2) Margin comments (red), stacked down the right column of their page.
    for q in result.get("questions", []) or []:
        for c in q.get("comments", []) or []:
            page = max(0, min(n_pages - 1, int(c.get("page", 1) or 1) - 1))
            text = str(c.get("text", "")).strip()
            if not text:
                continue
            w, h = dims[page]
            x = w * 0.58
            max_chars = max(14, int((w - 20 - x) / 4.6))
            lines = _wrap("- " + text, max_chars)
            leading = 12
            needed = len(lines) * leading + 6
            if cursors[page] - needed < 40:
                continue  # column full on this page
            ops[page].append(_text_block(x, cursors[page], 9, lines))
            cursors[page] -= needed

    # 3) Overall remark (red) across the bottom of the last page.
    remark = str(result.get("overall_remark", "")).strip()
    if remark:
        wl, hl = dims[n_pages - 1]
        lines = _wrap("Examiner remark: " + remark, max(30, int((wl - 56) / 4.6)))
        leading = 12
        start_y = 26 + (len(lines) - 1) * leading
        ops[n_pages - 1].append(_text_block(28, start_y, 9, lines))

    for i in range(n_pages):
        if ops[i]:
            try:
                _append_content(writer, i, "\n".join(ops[i]))
            except Exception:
                logger.exception("answer-eval failed to draw on page %s", i)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


# ── Public API ─────────────────────────────────────────────────────────────--
def presign_answer_upload_payload(
    user_id: str, filename: str, content_type: str, question: str = "", max_marks: int = 0, subject: str = ""
) -> Dict[str, Any]:
    # Block the upload up front if the user is out of free evals and credits.
    from . import billing_domain as billing
    billing.ensure_can_afford(user_id, billing.ANSWER_EVAL)
    bucket = _bucket()
    eval_id = f"answereval:{uuid.uuid4().hex}"
    ext = (filename or "answer.pdf").rsplit(".", 1)[-1].lower()
    if ext not in {"pdf"}:
        ext = "pdf"
    key = _eval_key(user_id, eval_id, f"original.{ext}")
    url = s3_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type or "application/pdf"},
        ExpiresIn=3600,
    )
    now = _now_iso()
    # Status flows: in_queue -> in_process -> completed/failed. Question + marks are
    # captured now so the S3-triggered worker can evaluate without any further call.
    answer_evaluations_collection().insert_one({
        "_id": eval_id,
        "doc_type": "answer_evaluation",
        "user_id": (user_id or "").strip(),
        "status": "in_queue",
        "filename": filename or "answer.pdf",
        "original_key": key,
        "marked_key": "",
        "question": (question or "").strip(),
        "subject": (subject or "").strip(),
        "max_marks": int(max_marks or 0),
        "result": None,
        "created_at": now,
        "updated_at": now,
    })
    logger.info("answer-eval queued id=%s key=%s", eval_id, key)
    # When an S3 upload-trigger is wired up, the frontend should NOT call /evaluate
    # (the object-created event drives it). Otherwise (local dev) it should.
    auto_evaluate = bool(settings().get("answer_eval_s3_trigger"))
    return {"eval_id": eval_id, "upload_url": url, "key": key, "auto_evaluate": auto_evaluate}


def evaluate_answer_payload(eval_id: str, question: str = "", max_marks: int = 0) -> Dict[str, Any]:
    """Manual/local trigger. In production the S3 object-created event drives
    evaluation instead; this stays for local dev and as a fallback (idempotent)."""
    collection = answer_evaluations_collection()
    doc = collection.find_one({"_id": eval_id, "doc_type": "answer_evaluation"})
    if not doc:
        raise LookupError("Evaluation not found")
    # Persist any question/marks passed here (in case they changed since presign).
    patch = {}
    if question:
        patch["question"] = question.strip()
    if max_marks:
        patch["max_marks"] = int(max_marks)
    if patch:
        collection.update_one({"_id": eval_id}, {"$set": {**patch, "updated_at": _now_iso()}})

    fn = current_lambda_function_name()
    if fn:
        lambda_client().invoke(
            FunctionName=fn,
            InvocationType="Event",
            Payload=json.dumps({"task": "evaluate_answer", "eval_id": eval_id}).encode("utf-8"),
        )
        logger.info("answer-eval queued (async) id=%s", eval_id)
        return {"eval_id": eval_id, "status": "in_process", "async": True}

    logger.info("answer-eval running (inline) id=%s", eval_id)
    return _run_evaluation(eval_id)


def run_evaluate_answer_task(event: Dict[str, Any]) -> Dict[str, Any]:
    return _safe_run_evaluation(str(event.get("eval_id") or ""))


def evaluate_from_object_key(bucket: str, key: str) -> Dict[str, Any]:
    """Entry point for the S3 upload trigger: map the uploaded object -> its
    evaluation record and run it. Ignores non-original / non-answer-eval keys."""
    key = str(key or "")
    if "answer-evaluations/" not in key or "/original." not in key:
        return {"skipped": True, "reason": "not an answer-eval upload", "key": key}
    doc = answer_evaluations_collection().find_one({"original_key": key, "doc_type": "answer_evaluation"})
    if not doc:
        logger.warning("answer-eval S3 trigger: no record for key=%s", key)
        return {"skipped": True, "reason": "no record", "key": key}
    return _safe_run_evaluation(doc["_id"])


def _safe_run_evaluation(eval_id: str) -> Dict[str, Any]:
    try:
        return _run_evaluation(eval_id)
    except Exception as err:  # noqa: BLE001
        logger.exception("answer-eval evaluation failed id=%s", eval_id)
        try:
            answer_evaluations_collection().update_one(
                {"_id": eval_id},
                {"$set": {"status": "failed", "error": str(err)[:500], "updated_at": _now_iso()}},
            )
        except Exception:
            logger.exception("answer-eval failed to record failure")
        return {"eval_id": eval_id, "status": "failed", "error": str(err)}


def _run_evaluation(eval_id: str) -> Dict[str, Any]:
    collection = answer_evaluations_collection()
    # Atomically claim the job so an S3 trigger + a manual call can't double-run it.
    doc = collection.find_one_and_update(
        {"_id": eval_id, "doc_type": "answer_evaluation", "status": {"$in": ["in_queue", "uploaded", "failed"]}},
        {"$set": {"status": "in_process", "error": "", "updated_at": _now_iso()}},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        existing = collection.find_one({"_id": eval_id, "doc_type": "answer_evaluation"})
        if not existing:
            raise LookupError("Evaluation not found")
        logger.info("answer-eval already %s id=%s — skipping", existing.get("status"), eval_id)
        return {"eval_id": eval_id, "status": existing.get("status"), "skipped": True}
    logger.info("answer-eval in_process id=%s", eval_id)

    question = str(doc.get("question", "") or "")
    max_marks = int(doc.get("max_marks") or 0)
    bucket = _bucket()
    original_key = doc["original_key"]

    pdf_bytes = s3_client().get_object(Bucket=bucket, Key=original_key)["Body"].read()
    pages = _extract_pages_text(pdf_bytes, bucket, original_key)
    if not any((p or "").strip() for p in pages):
        raise ValueError("Could not read any text from the PDF (is it blank, or OCR unavailable?)")

    result = _evaluate_with_llm(pages, question, max_marks)

    marked_bytes = pdf_bytes
    try:
        marked_bytes = _annotate_pdf(pdf_bytes, result)
    except Exception:
        logger.exception("answer-eval annotation failed id=%s (keeping original)", eval_id)

    marked_key = _eval_key(doc.get("user_id", ""), eval_id, "marked.pdf")
    s3_client().put_object(Bucket=bucket, Key=marked_key, Body=marked_bytes, ContentType="application/pdf")

    collection.update_one(
        {"_id": eval_id},
        {"$set": {
            "status": "completed",
            "result": result,
            "marked_key": marked_key,
            "pages": len(pages),
            "updated_at": _now_iso(),
        }},
    )
    logger.info("answer-eval completed id=%s marks=%s/%s", eval_id, result.get("total_awarded"), result.get("total_max"))
    # Charge on successful completion (free while within the free allowance). Best-effort
    # in the worker: the presign pre-check already gated affordability, so a charge here
    # should not fail — if it somehow does, don't undo a completed evaluation.
    try:
        from . import billing_domain as billing
        billing.charge_fixed(doc.get("user_id", ""), billing.ANSWER_EVAL, {"eval_id": eval_id})
    except Exception:
        logger.exception("answer-eval billing charge failed id=%s", eval_id)
    try:
        from .storage_domain import incr_answers_evaluated
        incr_answers_evaluated(doc.get("user_id", ""), 1)
    except Exception:
        logger.exception("usage incr_answers_evaluated failed")
    return {"eval_id": eval_id, "status": "completed", "result": result}


def _presigned_get(bucket: str, key: str, download: bool = False) -> str:
    if not key:
        return ""
    params = {"Bucket": bucket, "Key": key}
    if download:
        params["ResponseContentDisposition"] = 'attachment; filename="evaluated.pdf"'
    return s3_client().generate_presigned_url("get_object", Params=params, ExpiresIn=3600)


def get_answer_eval_payload(eval_id: str) -> Dict[str, Any]:
    doc = answer_evaluations_collection().find_one({"_id": eval_id, "doc_type": "answer_evaluation"})
    if not doc:
        raise LookupError("Evaluation not found")
    bucket = _bucket()
    return {
        "eval_id": eval_id,
        "status": doc.get("status"),
        "filename": doc.get("filename"),
        "result": doc.get("result"),
        "error": doc.get("error"),
        "original_url": _presigned_get(bucket, doc.get("original_key", "")),
        "marked_url": _presigned_get(bucket, doc.get("marked_key", "")),
        "marked_download_url": _presigned_get(bucket, doc.get("marked_key", ""), download=True),
        "created_at": doc.get("created_at"),
    }


def list_answer_evals_payload(
    user_id: str,
    q: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 200,
) -> Dict[str, Any]:
    """List a user's evaluations, newest first. Optional filters:
    - q: case-insensitive substring match on the question text (subject) or filename.
    - from_date / to_date: inclusive bounds on created_at (YYYY-MM-DD)."""
    query: Dict[str, Any] = {"doc_type": "answer_evaluation", "user_id": (user_id or "").strip()}

    term = (q or "").strip()
    if term:
        rx = {"$regex": re.escape(term), "$options": "i"}
        query["$or"] = [{"subject": rx}, {"question": rx}, {"filename": rx}]

    created: Dict[str, str] = {}
    if (from_date or "").strip():
        created["$gte"] = from_date.strip()
    if (to_date or "").strip():
        # created_at is an ISO timestamp; extend an inclusive end-of-day bound.
        created["$lte"] = to_date.strip() + "T23:59:59.999999+00:00"
    if created:
        query["created_at"] = created

    cur = answer_evaluations_collection().find(query).sort("created_at", -1).limit(int(limit))
    items = []
    for d in cur:
        res = d.get("result") or {}
        items.append({
            "eval_id": d.get("_id"),
            "filename": d.get("filename"),
            "question": d.get("question"),
            "subject": d.get("subject"),
            "status": d.get("status"),
            "total_awarded": res.get("total_awarded"),
            "total_max": res.get("total_max"),
            "created_at": d.get("created_at"),
        })
    return {"evaluations": items}
