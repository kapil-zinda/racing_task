"""Thin Upstash Vector REST client (stdlib urllib only, matching the OpenAI helper style).

Replaces MongoDB Atlas `$vectorSearch` for PDF search. The Upstash index must be created
with `dimensions` equal to OPENAI_EMBEDDINGS_DIMENSIONS and metric = COSINE.

Env: UPSTASH_VECTOR_REST_URL, UPSTASH_VECTOR_REST_TOKEN.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .context import logger, settings


def _cfg() -> tuple[str, str]:
    s = settings()
    url = (s.get("upstash_vector_rest_url") or "").strip().rstrip("/")
    token = (s.get("upstash_vector_rest_token") or "").strip()
    return url, token


def is_configured() -> bool:
    url, token = _cfg()
    return bool(url and token)


def _post(path: str, body: Any) -> Dict[str, Any]:
    url, token = _cfg()
    if not url or not token:
        raise RuntimeError("Upstash Vector is not configured (UPSTASH_VECTOR_REST_URL / _TOKEN)")
    request = Request(
        f"{url}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Upstash Vector {path} failed: HTTP {err.code} {detail}") from err
    except URLError as err:
        raise RuntimeError(f"Upstash Vector {path} failed: {err.reason}") from err


def upsert(items: List[Dict[str, Any]]) -> None:
    """Batch upsert. Each item: {"id": str, "vector": [float], "metadata": {...}}."""
    if not items:
        return
    _post("/upsert", items)


def query(vector: List[float], top_k: int = 10, flt: Optional[str] = None,
          include_metadata: bool = True) -> List[Dict[str, Any]]:
    body: Dict[str, Any] = {"vector": vector, "topK": int(top_k), "includeMetadata": include_metadata}
    if flt:
        body["filter"] = flt
    result = _post("/query", body).get("result", []) or []
    return result


def delete_by_filter(flt: str) -> int:
    """Delete all vectors matching a metadata filter. Returns count (best-effort)."""
    if not flt:
        return 0
    try:
        res = _post("/delete", {"filter": flt}).get("result", {}) or {}
        return int(res.get("deleted", 0) or 0)
    except Exception:  # noqa: BLE001 — deletion is best-effort cleanup
        logger.exception("Upstash delete_by_filter failed (%s)", flt)
        return 0


def delete_ids(ids: List[str]) -> int:
    if not ids:
        return 0
    try:
        res = _post("/delete", {"ids": ids}).get("result", {}) or {}
        return int(res.get("deleted", 0) or 0)
    except Exception:  # noqa: BLE001
        logger.exception("Upstash delete_ids failed")
        return 0


def escape(value: str) -> str:
    """Escape a string for use inside a metadata filter literal."""
    return str(value).replace("\\", "\\\\").replace("'", "\\'")
