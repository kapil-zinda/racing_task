import base64
import hashlib
import json
import os
import random
import secrets
import string
import urllib.request
from datetime import datetime, timedelta, timezone

from pymongo import ASCENDING

from .context import logger, otps_collection, settings, users_collection

_OTP_TTL_SECONDS = 300  # 5 minutes


def _ensure_indexes():
    otps_col = otps_collection()
    otps_col.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0, background=True)
    users_col = users_collection()
    users_col.create_index([("email", ASCENDING)], unique=True, background=True)
    users_col.create_index([("api_key", ASCENDING)], background=True)


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000)
    return f"{salt}:{dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, dk_hex = stored.split(":", 1)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000)
        return secrets.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


def _generate_otp() -> str:
    return "".join(random.choices(string.digits, k=6))


def _send_otp_email(to_email: str, otp: str, name: str) -> bool:
    """Returns True if email was sent successfully, False otherwise."""
    cfg = settings()
    api_key = cfg.get("mailjet_api_key", "")
    secret_key = cfg.get("mailjet_secret_key", "")
    if not api_key or not secret_key:
        logger.warning("MAILJET_API_KEY/MAILJET_SECRET_KEY not set — OTP not sent (otp=%s)", otp)
        return False
    credentials = base64.b64encode(f"{api_key}:{secret_key}".encode()).decode()
    body = json.dumps(
        {
            "Messages": [
                {
                    "From": {"Email": "no_reply@uchhal.in", "Name": "uchhal"},
                    "To": [{"Email": to_email, "Name": name}],
                    "Subject": "Your verification code",
                    "TextPart": f"Hi {name},\n\nYour OTP is: {otp}\n\nIt expires in 5 minutes.",
                }
            ]
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.mailjet.com/v3.1/send",
        data=body,
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status != 200:
                logger.error("Mailjet error: status=%s", resp.status)
                return False
            return True
    except Exception as exc:
        logger.error("Mailjet request failed: %s", exc)
        return False


def signup(email: str, name: str, phone: str, password: str) -> dict:
    email = email.strip().lower()
    col = users_collection()
    if col.find_one({"email": email}):
        raise ValueError("Email already registered")
    otp = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_OTP_TTL_SECONDS)
    otps_col = otps_collection()
    otps_col.delete_many({"email": email})
    otps_col.insert_one(
        {
            "email": email,
            "name": name,
            "phone": phone,
            "password_hash": _hash_password(password),
            "otp": otp,
            "expires_at": expires_at,
        }
    )
    sent = _send_otp_email(email, otp, name)
    result = {"message": "OTP sent to your email"}
    if not sent:
        result["otp"] = otp
        result["message"] = "Email delivery unavailable — use the OTP below"
    return result


def verify_otp(email: str, otp: str) -> dict:
    email = email.strip().lower()
    otps_col = otps_collection()
    record = otps_col.find_one({"email": email})
    if not record:
        raise LookupError("No pending OTP for this email")
    if datetime.now(timezone.utc) > record["expires_at"].replace(tzinfo=timezone.utc):
        raise ValueError("OTP has expired")
    if not secrets.compare_digest(record["otp"], otp):
        raise ValueError("Invalid OTP")
    users_col = users_collection()
    api_key = secrets.token_urlsafe(32)
    user_doc = {
        "email": email,
        "name": record["name"],
        "phone": record.get("phone", ""),
        "password_hash": record["password_hash"],
        "api_key": api_key,
        "created_at": datetime.now(timezone.utc),
    }
    users_col.insert_one(user_doc)
    otps_col.delete_many({"email": email})
    return {
        "message": "Account created",
        "user_id": str(user_doc["_id"]),
        "name": user_doc["name"],
        "email": email,
        "api_key": api_key,
    }


def resend_otp(email: str) -> dict:
    email = email.strip().lower()
    otps_col = otps_collection()
    record = otps_col.find_one({"email": email})
    if not record:
        raise LookupError("No pending signup for this email")
    otp = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_OTP_TTL_SECONDS)
    otps_col.update_one({"email": email}, {"$set": {"otp": otp, "expires_at": expires_at}})
    sent = _send_otp_email(email, otp, record.get("name", ""))
    result = {"message": "OTP resent"}
    if not sent:
        result["otp"] = otp
        result["message"] = "Email delivery unavailable — use the OTP below"
    return result


def signin(email: str, password: str) -> dict:
    email = email.strip().lower()
    users_col = users_collection()
    user = users_col.find_one({"email": email})
    if not user or not _verify_password(password, user["password_hash"]):
        raise ValueError("Invalid email or password")
    return {
        "user_id": str(user["_id"]),
        "name": user["name"],
        "email": email,
        "api_key": user["api_key"],
    }


def get_user_by_api_key(api_key: str) -> dict | None:
    users_col = users_collection()
    user = users_col.find_one({"api_key": api_key})
    if not user:
        return None
    return {"user_id": str(user["_id"]), "name": user["name"], "email": user["email"]}


def init_auth_service() -> None:
    try:
        _ensure_indexes()
        logger.info("Auth service indexes ensured")
    except Exception as exc:
        logger.warning("Auth service index setup failed: %s", exc)
