"""UPSC Mains answer evaluation.

The candidate uploads an answer PDF; the backend reads the question + answer
(typed text via pypdf, or handwriting via Textract OCR), evaluates it like a real
Mains examiner with an LLM (strict marks + breakdown + margin comments), and writes
those comments and marks back onto the PDF as annotations. Long jobs run async on
Lambda (self-invoke), inline off Lambda.
"""

import difflib
import io
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

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
def _extract_pages_text(pdf_bytes: bytes, bucket: str, key: str) -> Tuple[List[str], List[Optional[List[Dict[str, Any]]]]]:
    """Returns (pages_text, pages_lines). ``pages_lines[i]`` is None for pages read via
    pypdf (typed PDFs — no per-line geometry available); it's a list of
    ``{"text","top","left","width","height"}`` line dicts (Textract, normalized 0-1
    bbox) when the OCR path was used. Used later to locate quoted comments on the page
    for the markup overlay — see ``_locate_quote_bbox``."""
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
        return pages, [None] * len(pages)

    # Sparse/empty text -> likely handwritten/scanned. Try Textract OCR.
    try:
        from .pdf_search_domain import _extract_pdf_pages_from_textract

        ocr = _extract_pdf_pages_from_textract(bucket, key, with_bbox=True)
        if ocr:
            logger.info("answer-eval used Textract OCR (%d pages) for %s", len(ocr), key)
            return (
                [str(p.get("text", "") or "") for p in ocr],
                [p.get("lines") or [] for p in ocr],
            )
    except Exception:
        logger.exception("answer-eval Textract OCR failed for %s", key)
    return pages, [None] * len(pages)


def _normalize_for_match(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _locate_quote_bbox(lines: Optional[List[Dict[str, Any]]], quote: str) -> Optional[Dict[str, float]]:
    """Best-effort: find which OCR line(s) on a page contain ``quote`` and return a
    normalized (0-1) bounding box, merging up to 3 consecutive lines if the quote spans
    a line break. Returns None if there's no OCR geometry for this page or no
    reasonable match — highlighting is an enhancement, never load-bearing."""
    if not lines or not (quote or "").strip():
        return None
    q = _normalize_for_match(quote)
    if not q:
        return None

    def bbox_of(items: List[Dict[str, Any]]) -> Dict[str, float]:
        top = min(it["top"] for it in items)
        left = min(it["left"] for it in items)
        right = max(it["left"] + it.get("width", 0.0) for it in items)
        bottom = max(it["top"] + it.get("height", 0.0) for it in items)
        return {"top": top, "left": left, "width": max(0.0, right - left), "height": max(0.0, bottom - top)}

    # 1) exact substring on a single line.
    for ln in lines:
        if q in _normalize_for_match(ln.get("text", "")):
            return bbox_of([ln])

    # 2) substring spanning up to 3 consecutive lines.
    for span in (2, 3):
        for i in range(len(lines) - span + 1):
            window = lines[i:i + span]
            joined = _normalize_for_match(" ".join(ln.get("text", "") for ln in window))
            if q in joined:
                return bbox_of(window)

    # 3) fuzzy best-match single line above a similarity threshold.
    best, best_ratio = None, 0.0
    for ln in lines:
        ratio = difflib.SequenceMatcher(None, q, _normalize_for_match(ln.get("text", ""))).ratio()
        if ratio > best_ratio:
            best, best_ratio = ln, ratio
    if best is not None and best_ratio >= 0.55:
        return bbox_of([best])
    return None


# ── LLM evaluation ─────────────────────────────────────────────────────────--
_CORE_METRICS = ["Analytical Depth", "Critical Thinking", "Language & Expression", "Relevance"]

_EVAL_SCHEMA = (
    'Return ONLY JSON: {'
    '"questions": [{'
    '"question_text": "<the question, detected or given>",'
    '"max_marks": <int>,'
    '"word_count": <int, approx words the candidate wrote for THIS question>,'
    '"sections": [{'
    '"name": "introduction|body|conclusion|structure",'
    '"max_marks": <number, section allotments MUST sum exactly to the question max_marks>,'
    '"awarded_marks": <number>,'
    '"label": "Excellent|Good|Average|Needs Work",'
    '"remark": "<1-2 sentence assessment of this section>",'
    '"strengths": ["<short positive point>"],'
    '"improvements": [{"issue": "<short weakness name>", "explanation": "<why it matters / what to fix>", '
    '"model_sentence": "<one exemplar sentence demonstrating the fix, in the candidate context>"}],'
    '"start_quote": "<4-10 words copied VERBATIM from the source text where this section begins, empty string if not locatable>",'
    '"start_page": <1-based int>'
    '}],'
    '"core_metrics": [{"name": "Analytical Depth|Critical Thinking|Language & Expression|Relevance", "score": <0-10>}],'
    '"subject_metrics": [{"name": "<subject-specific criterion for this question, e.g. Correct Use of Sociological Terminology>", "score": <0-10>}],'
    '"missing_keywords": [{"term": "<key concept/name/term the answer should have used>", "why": "<1 sentence on why it matters here>"}],'
    '"next_attempt_focus": {"section": "introduction|body|conclusion|structure", "marks_impact": <number, marks lost to this ONE issue>, '
    '"quote": "<4-10 words copied VERBATIM from the source text this note refers to>", "issue": "<the single highest-leverage fix>", '
    '"model_sentence": "<exemplar sentence demonstrating the fix>"},'
    '"model_answer": {"introduction": "<ideal intro>", "body": "<ideal body, may include bullet points as plain text>", "conclusion": "<ideal conclusion>"},'
    '"comments": [{"page": <1-based int>, "tag": "good|missing|improve", "text": "<short margin comment>", '
    '"quote": "<4-10 words copied VERBATIM from the source text this comment refers to, empty string if general>"}]'
    '}],'
    '"total_awarded": <number>, "total_max": <int>,'
    '"overall_remark": "<2-4 sentence examiner remark>",'
    '"strengths": ["..."], "improvements": ["..."]'
    '}'
)


def _evaluate_with_llm(
    pages: List[str], question: str, max_marks: int, has_diagrams: bool = True, language: str = "English",
) -> Dict[str, Any]:
    joined = "\n\n".join(f"[Page {i + 1}]\n{t}" for i, t in enumerate(pages) if t).strip()
    joined = joined[:MAX_TEXT_CHARS] or "(no readable text extracted)"

    system = (
        "You are a senior UPSC Civil Services Mains examiner. Evaluate the candidate's answer EXACTLY like a real "
        "examiner — strict and realistic (Mains averages roughly 45–55%). Reward: clear intro–body–conclusion structure, "
        "multi-dimensional coverage, directive compliance (analyse/examine/critically/discuss), relevant examples, data, "
        "committee/report/article references, and apt diagrams or flowcharts. Penalise: vagueness, unsubstantiated claims, "
        "missing dimensions, one-sidedness, poor structure, and word-limit violations. Marks must be granular and honest.\n\n"
        "Grade by STRUCTURAL SECTION (introduction, body, conclusion, and a separate 'structure' section judging overall "
        "organisation/flow/handwriting-legibility/presentation). Section max_marks must sum exactly to the question's "
        "max_marks, and each section's awarded_marks must be honest given its own max_marks. For each section give a "
        "qualitative label, what the candidate did well, and named improvement areas — each improvement needs a short "
        "explanation AND a model_sentence showing what a strong answer would have written there.\n\n"
        "Separately score two families of criteria (0-10 each): the four fixed core_metrics "
        f"({', '.join(_CORE_METRICS)}), and 2-4 subject_metrics you choose that are specific to this question's subject "
        "matter (e.g. correct use of theory/terminology, factual accuracy, application to context).\n\n"
        "List missing_keywords: the specific named concepts/thinkers/terms/reports the answer should have used but "
        "didn't, each with a one-line reason. Pick the SINGLE most impactful fix across the whole answer as "
        "next_attempt_focus, quantifying roughly how many marks that one fix would likely recover.\n\n"
        "Write a model_answer (introduction/body/conclusion) that is what a 9-10/10 answer to this exact question would "
        "look like — a real, complete, usable study reference, not a stub.\n\n"
        "Write the margin comments the way an examiner pens them: short, specific, actionable (e.g. 'Good — links to NITI "
        "Aayog', 'Missing: federalism dimension', 'Add a recent example', 'Conclusion too generic'). Tag each comment "
        "good/missing/improve and the page it belongs to. For every comment, section start_quote, and next_attempt_focus "
        "quote, copy the phrase VERBATIM (4-10 consecutive words, exact spelling/case as given) from the candidate answer "
        "text below so it can be located and highlighted — never paraphrase these quotes, and leave the quote empty "
        "rather than inventing text that isn't there.\n\n" + _EVAL_SCHEMA
    )
    hint = (
        "The PDF may contain answers to MORE THAN ONE question. Detect every distinct question and "
        "evaluate each one separately as its own item in \"questions\" (with its own marks, sections and comments).\n"
    )
    if question.strip():
        hint += f"The question(s) provided by the candidate: {question.strip()}\n"
    if max_marks:
        hint += f"Total marks for this submission: {max_marks} (split it sensibly across the detected questions).\n"
    else:
        hint += (
            "Max marks were NOT provided. Detect each question's mark allotment from the paper itself "
            "(look for '(10 marks)', '(15 marks)', word limits like 150/250 words → 10/15 markers). "
            "If it is genuinely not stated, default to 10 marks for ~150-word questions and 15 for ~250-word ones. "
            "Always set a positive max_marks for every question and a correct total_max.\n"
        )
    hint += (
        f"The candidate says they wrote in: {language or 'English'}. Evaluate the content in that language "
        "but write ALL feedback (comments, remarks, model_answer, model_sentence) in English.\n"
    )
    hint += (
        "The candidate confirmed their answer INCLUDES diagrams/maps/flowcharts — evaluate any described or "
        "visible diagram as part of content/structure scoring.\n"
        if has_diagrams
        else "The candidate says their answer has no diagrams/maps/flowcharts to evaluate — do not penalise for "
        "missing visuals; grade on written content only.\n"
    )
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


def _finalize_result(result: Dict[str, Any], pages_lines: List[Optional[List[Dict[str, Any]]]]) -> Dict[str, Any]:
    """Server-side truth pass: recompute marks from section sums (the LLM's own math
    can drift), and best-effort attach a normalized bbox to every quote so the frontend
    overlay viewer can position a highlight without re-parsing the PDF itself."""
    def lines_for(page_1based: int) -> Optional[List[Dict[str, Any]]]:
        idx = int(page_1based or 1) - 1
        if 0 <= idx < len(pages_lines):
            return pages_lines[idx]
        return None

    total_awarded = 0.0
    total_max = 0
    for q in result.get("questions", []) or []:
        sections = q.get("sections") or []
        if sections:
            sec_awarded = 0.0
            sec_max = 0.0
            for sec in sections:
                try:
                    sec_awarded += float(sec.get("awarded_marks") or 0)
                    sec_max += float(sec.get("max_marks") or 0)
                except (TypeError, ValueError):
                    pass
                quote = str(sec.get("start_quote") or "").strip()
                page = int(sec.get("start_page") or 1)
                bbox = _locate_quote_bbox(lines_for(page), quote) if quote else None
                if bbox:
                    sec["start_bbox"] = {"page": page, **bbox}
            q["awarded_marks"] = round(sec_awarded, 2)
            if sec_max:
                q["max_marks"] = int(round(sec_max))
        try:
            total_awarded += float(q.get("awarded_marks") or 0)
            total_max += int(q.get("max_marks") or 0)
        except (TypeError, ValueError):
            pass

        for c in q.get("comments", []) or []:
            quote = str(c.get("quote") or "").strip()
            page = int(c.get("page") or 1)
            bbox = _locate_quote_bbox(lines_for(page), quote) if quote else None
            if bbox:
                c["bbox"] = {"page": page, **bbox}

        naf = q.get("next_attempt_focus") or None
        if isinstance(naf, dict):
            quote = str(naf.get("quote") or "").strip()
            # next_attempt_focus has no page field — search every page for the quote.
            for page_idx, lns in enumerate(pages_lines, start=1):
                bbox = _locate_quote_bbox(lns, quote) if quote else None
                if bbox:
                    naf["bbox"] = {"page": page_idx, **bbox}
                    break

    result["total_awarded"] = round(total_awarded, 2)
    result["total_max"] = total_max or result.get("total_max", 0)
    return result


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
    ops[0].append(_text_block(28, h0 - 34, 14, _wrap(header, max(16, int((w0 - 56) / 7.0)))))

    # 2) Margin comments (red), stacked down the right column of their page.
    for q in result.get("questions", []) or []:
        for c in q.get("comments", []) or []:
            page = max(0, min(n_pages - 1, int(c.get("page", 1) or 1) - 1))
            text = str(c.get("text", "")).strip()
            if not text:
                continue
            w, h = dims[page]
            x = w * 0.56
            max_chars = max(12, int((w - 20 - x) / 6.0))
            lines = _wrap("- " + text, max_chars)
            leading = 15
            needed = len(lines) * leading + 8
            if cursors[page] - needed < 40:
                continue  # column full on this page
            ops[page].append(_text_block(x, cursors[page], 12, lines))
            cursors[page] -= needed

    # 3) Overall remark (red) across the bottom of the last page.
    remark = str(result.get("overall_remark", "")).strip()
    if remark:
        wl, hl = dims[n_pages - 1]
        lines = _wrap("Examiner remark: " + remark, max(24, int((wl - 56) / 6.0)))
        leading = 15
        start_y = 28 + (len(lines) - 1) * leading
        ops[n_pages - 1].append(_text_block(28, start_y, 12, lines))

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
    user_id: str, filename: str, content_type: str, question: str = "", max_marks: int = 0, subject: str = "",
    has_diagrams: bool = True, language: str = "English",
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
        "has_diagrams": bool(has_diagrams),
        "language": (language or "English").strip() or "English",
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
    has_diagrams = bool(doc.get("has_diagrams", True))
    language = str(doc.get("language", "") or "English")
    bucket = _bucket()
    original_key = doc["original_key"]

    pdf_bytes = s3_client().get_object(Bucket=bucket, Key=original_key)["Body"].read()
    pages, pages_lines = _extract_pages_text(pdf_bytes, bucket, original_key)
    if not any((p or "").strip() for p in pages):
        raise ValueError("Could not read any text from the PDF (is it blank, or OCR unavailable?)")

    result = _evaluate_with_llm(pages, question, max_marks, has_diagrams, language)
    result = _finalize_result(result, pages_lines)

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
    # One PDF may contain several questions; each detected question counts as one
    # answer evaluation for billing and usage.
    n_questions = max(1, len(result.get("questions") or []))
    logger.info("answer-eval completed id=%s marks=%s/%s questions=%s", eval_id,
                result.get("total_awarded"), result.get("total_max"), n_questions)
    # Charge on successful completion (free while within the free allowance). Best-effort
    # in the worker: the presign pre-check already gated affordability, so a charge here
    # should not fail — if it somehow does, don't undo a completed evaluation.
    from . import billing_domain as billing
    try:
        billing.charge_fixed(doc.get("user_id", ""), billing.ANSWER_EVAL,
                             {"eval_id": eval_id, "questions": n_questions}, units=n_questions)
    except Exception as err:
        logger.exception("answer-eval billing charge failed id=%s", eval_id)
        billing._record_failed(doc.get("user_id", ""), billing.ANSWER_EVAL,
                                {"eval_id": eval_id, "questions": n_questions}, err)
    try:
        from .storage_domain import incr_answers_evaluated
        incr_answers_evaluated(doc.get("user_id", ""), n_questions)
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
