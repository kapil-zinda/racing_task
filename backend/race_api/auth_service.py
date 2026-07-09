from __future__ import annotations

import hashlib
import json
import os
import random
import secrets
import string
import urllib.error
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


def _send_otp_email(to_email: str, otp: str, name: str, purpose: str = "signup") -> bool:
    """Returns True if email was sent successfully, False otherwise."""
    cfg = settings()
    api_key = cfg.get("resend_api_key", "")
    if not api_key:
        return False
    subject = "Reset your password" if purpose == "reset" else "Your verification code"
    intro = "Your password reset code is" if purpose == "reset" else "Your OTP is"
    body = json.dumps(
        {
            "from": "Dias <no_reply@uchhal.in>",
            "to": [to_email],
            "subject": subject,
            "text": f"Hi {name},\n\n{intro}: {otp}\n\nIt expires in 5 minutes.",
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # Cloudflare (fronting api.resend.com) 403s the default
            # "Python-urllib/x.y" User-Agent with error 1010, so set our own.
            "User-Agent": "race-api/2.0 (+https://uchhal.in)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status not in (200, 201):
                logger.error("Resend error: status=%s", resp.status)
                return False
            return True
    except urllib.error.HTTPError as exc:
        # Resend puts the actual reason (unverified domain, restricted key,
        # rate limit, testing-mode recipient restriction) in the JSON body.
        try:
            detail = exc.read().decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            detail = ""
        logger.error("Resend rejected email: status=%s body=%s", exc.code, detail)
        return False
    except Exception as exc:  # noqa: BLE001
        logger.error("Resend request failed: %s", exc)
        return False


def _normalize_phone(phone: str) -> str:
    """Validate and normalise a phone number to E.164 (e.g. ``+919876543210``).

    Requires an explicit country code (leading ``+``). Strips spaces, dashes and
    parentheses. Raises ValueError on anything that isn't a plausible number.
    """
    raw = (phone or "").strip()
    if not raw:
        raise ValueError("Phone number is required")
    # Drop common separators; keep a single leading '+'.
    cleaned = raw.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if cleaned.startswith("00"):  # 00 is an alternate international prefix
        cleaned = "+" + cleaned[2:]
    if not cleaned.startswith("+"):
        raise ValueError("Phone number must include a country code, e.g. +91…")
    digits = cleaned[1:]
    if not digits.isdigit():
        raise ValueError("Phone number may only contain digits after the country code")
    # E.164: 1–3 digit country code + subscriber number, 8–15 digits total.
    if not (8 <= len(digits) <= 15):
        raise ValueError("Phone number must be 8–15 digits including the country code")
    if digits[0] == "0":
        raise ValueError("Country code cannot start with 0")
    return "+" + digits


def signup(email: str, name: str, phone: str, password: str) -> dict:
    email = email.strip().lower()
    phone = _normalize_phone(phone)
    col = users_collection()
    if col.find_one({"email": email}):
        raise ValueError("Email already registered")
    otp = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_OTP_TTL_SECONDS)
    otps_col = otps_collection()
    otps_col.delete_many({"email": email, "purpose": "signup"})
    otps_col.insert_one(
        {
            "email": email,
            "name": name,
            "phone": phone,
            "password_hash": _hash_password(password),
            "otp": otp,
            "purpose": "signup",
            "expires_at": expires_at,
        }
    )
    sent = _send_otp_email(email, otp, name, purpose="signup")
    if not sent:
        return {"message": "Could not send verification email — please try again"}
    return {"message": "OTP sent to your email"}


def verify_otp(email: str, otp: str) -> dict:
    email = email.strip().lower()
    otps_col = otps_collection()
    record = otps_col.find_one({"email": email, "purpose": "signup"})
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
    otps_col.delete_many({"email": email, "purpose": "signup"})
    return {
        "message": "Account created",
        "user_id": str(user_doc["_id"]),
        "name": user_doc["name"],
        "email": email,
        "phone": user_doc["phone"],
        "api_key": api_key,
    }


def resend_otp(email: str, purpose: str = "signup") -> dict:
    email = email.strip().lower()
    otps_col = otps_collection()
    record = otps_col.find_one({"email": email, "purpose": purpose})
    if not record:
        raise LookupError("No pending request for this email")
    otp = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_OTP_TTL_SECONDS)
    otps_col.update_one({"email": email, "purpose": purpose}, {"$set": {"otp": otp, "expires_at": expires_at}})
    sent = _send_otp_email(email, otp, record.get("name", ""), purpose=purpose)
    if not sent:
        return {"message": "Could not send verification email — please try again"}
    return {"message": "OTP resent"}


def signin(email: str, password: str) -> dict:
    email = email.strip().lower()
    users_col = users_collection()
    user = users_col.find_one({"email": email})
    if not user or not _verify_password(password, user["password_hash"]):
        raise ValueError("Invalid email or password")
    if user.get("disabled"):
        raise ValueError("This account has been deleted")
    return {
        "user_id": str(user["_id"]),
        "name": user["name"],
        "email": email,
        "phone": user.get("phone", ""),
        "api_key": user["api_key"],
    }


def get_user_by_api_key(api_key: str) -> dict | None:
    users_col = users_collection()
    user = users_col.find_one({"api_key": api_key})
    if not user or user.get("disabled"):
        return None
    return {
        "user_id": str(user["_id"]),
        "name": user["name"],
        "email": user["email"],
        "phone": user.get("phone", ""),
    }


def forgot_password(email: str) -> dict:
    """Always returns the same generic message, whether or not the email is
    registered, so this can't be used to enumerate accounts."""
    email = email.strip().lower()
    generic = {"message": "If that email is registered, we've sent a reset code"}
    user = users_collection().find_one({"email": email})
    if not user or user.get("disabled"):
        return generic
    otp = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_OTP_TTL_SECONDS)
    otps_col = otps_collection()
    otps_col.delete_many({"email": email, "purpose": "reset"})
    otps_col.insert_one(
        {
            "email": email,
            "name": user.get("name", ""),
            "otp": otp,
            "purpose": "reset",
            "expires_at": expires_at,
        }
    )
    _send_otp_email(email, otp, user.get("name", ""), purpose="reset")
    return generic


def reset_password(email: str, otp: str, new_password: str) -> dict:
    email = email.strip().lower()
    otps_col = otps_collection()
    record = otps_col.find_one({"email": email, "purpose": "reset"})
    if not record:
        raise LookupError("No pending password reset for this email")
    if datetime.now(timezone.utc) > record["expires_at"].replace(tzinfo=timezone.utc):
        raise ValueError("OTP has expired")
    if not secrets.compare_digest(record["otp"], otp):
        raise ValueError("Invalid OTP")
    users_col = users_collection()
    user = users_col.find_one({"email": email})
    if not user or user.get("disabled"):
        raise LookupError("Account not found")
    # Rotate the api_key too: this is a recovery flow, so any stale/leaked
    # session for this account should stop working once the password resets.
    api_key = secrets.token_urlsafe(32)
    users_col.update_one(
        {"email": email},
        {"$set": {"password_hash": _hash_password(new_password), "api_key": api_key}},
    )
    otps_col.delete_many({"email": email, "purpose": "reset"})
    return {
        "message": "Password reset",
        "user_id": str(user["_id"]),
        "name": user["name"],
        "email": email,
        "phone": user.get("phone", ""),
        "api_key": api_key,
    }


def update_profile(user_id: str, name: str) -> dict:
    from bson import ObjectId

    name = (name or "").strip()
    if not name:
        raise ValueError("Name is required")
    users_col = users_collection()
    result = users_col.update_one({"_id": ObjectId(user_id)}, {"$set": {"name": name}})
    if result.matched_count == 0:
        raise LookupError("User not found")
    return {"message": "Profile updated", "name": name}


def change_password(user_id: str, current_password: str, new_password: str) -> dict:
    from bson import ObjectId

    users_col = users_collection()
    user = users_col.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise LookupError("User not found")
    if not _verify_password(current_password, user["password_hash"]):
        raise ValueError("Current password is incorrect")
    if len(new_password or "") < 8:
        raise ValueError("New password must be at least 8 characters")
    users_col.update_one({"_id": ObjectId(user_id)}, {"$set": {"password_hash": _hash_password(new_password)}})
    return {"message": "Password changed"}


def delete_account(user_id: str, password: str) -> dict:
    """Soft delete: disables login immediately (rotates the api_key so the
    current session dies too) but keeps the user's data — no data is purged."""
    from bson import ObjectId

    users_col = users_collection()
    user = users_col.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise LookupError("User not found")
    if not _verify_password(password, user["password_hash"]):
        raise ValueError("Password is incorrect")
    users_col.update_one(
        {"_id": ObjectId(user_id)},
        {
            "$set": {
                "disabled": True,
                "deleted_at": datetime.now(timezone.utc),
                "api_key": secrets.token_urlsafe(32),
            }
        },
    )
    return {"message": "Account deleted"}


def init_auth_service() -> None:
    try:
        _ensure_indexes()
        logger.info("Auth service indexes ensured")
    except Exception as exc:
        logger.warning("Auth service index setup failed: %s", exc)
