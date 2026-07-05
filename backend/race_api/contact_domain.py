"""Contact / feedback — emails messages from the public Contact page to the owner.

Uses the same Resend REST style as auth_service (stdlib urllib, explicit User-Agent so
Cloudflare doesn't 403 the default Python-urllib agent). Reply-To is set to the sender
so the owner can reply straight from their inbox.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict

from .context import logger, settings

CONTACT_RECIPIENT = "kapilchaudhary8280@gmail.com"
_FROM = "Dias <no_reply@uchhal.in>"


def send_contact_message(name: str, email: str, message: str, subject: str = "") -> Dict[str, Any]:
    name = (name or "").strip()
    email = (email or "").strip()
    message = (message or "").strip()
    if not message:
        raise ValueError("Message is required")
    if "@" not in email or "." not in email:
        raise ValueError("A valid email is required")

    api_key = (settings().get("resend_api_key") or "").strip()
    if not api_key:
        raise RuntimeError("Email delivery is not configured")

    subj = (subject or "").strip() or f"New Dias message from {name or email}"
    text = f"From: {name or '(no name)'} <{email}>\n\n{message}"
    body = json.dumps({
        "from": _FROM,
        "to": [CONTACT_RECIPIENT],
        "reply_to": email,
        "subject": subj,
        "text": text,
    }).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "race-api/2.0 (+https://dias.uchhal.in)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status not in (200, 201):
                logger.error("Resend contact error: status=%s", resp.status)
                raise RuntimeError("Could not send your message — please try again")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace") if hasattr(exc, "read") else ""
        logger.error("Resend contact rejected: status=%s body=%s", exc.code, detail)
        raise RuntimeError("Could not send your message — please try again")
    except RuntimeError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("Resend contact request failed: %s", exc)
        raise RuntimeError("Could not send your message — please try again")

    return {"sent": True, "message": "Thanks — your message has been sent."}
