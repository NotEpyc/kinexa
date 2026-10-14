"""Small, dependency-free JWT and password helpers for the Kinexa prototype."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import User, get_db

bearer = HTTPBearer(auto_error=False)
PASSWORD_ITERATIONS = 600_000
TOKEN_LIFETIME_SECONDS = 30 * 60


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _secret() -> bytes:
    secret = os.getenv("AUTH_SECRET_KEY", "").strip()
    if len(secret) < 32 or secret.startswith("replace-with-"):
        raise HTTPException(status_code=503, detail="Authentication is not configured. Set AUTH_SECRET_KEY to a random secret of at least 32 characters.")
    return secret.encode("utf-8")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${_b64(salt)}${_b64(derived)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_text, expected_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text + "=" * (-len(salt_text) % 4))
        expected = base64.urlsafe_b64decode(expected_text + "=" * (-len(expected_text) % 4))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def create_access_token(user: User) -> str:
    now = int(time.time())
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64(json.dumps({
        "sub": user.id, "role": user.role, "iat": now,
        "exp": now + TOKEN_LIFETIME_SECONDS,
    }, separators=(",", ":")).encode())
    signing_input = f"{header}.{payload}"
    signature = hmac.new(_secret(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64(signature)}"


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        header_text, payload_text, signature_text = token.split(".")
        header = json.loads(base64.urlsafe_b64decode(header_text + "=" * (-len(header_text) % 4)))
        payload = json.loads(base64.urlsafe_b64decode(payload_text + "=" * (-len(payload_text) % 4)))
        expected = hmac.new(_secret(), f"{header_text}.{payload_text}".encode(), hashlib.sha256).digest()
        actual = base64.urlsafe_b64decode(signature_text + "=" * (-len(signature_text) % 4))
        if header != {"alg": "HS256", "typ": "JWT"} or not hmac.compare_digest(actual, expected):
            raise ValueError("invalid signature")
        if not isinstance(payload.get("exp"), int) or payload["exp"] <= int(time.time()):
            raise ValueError("expired")
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired access token", headers={"WWW-Authenticate": "Bearer"}) from exc


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    token = request.cookies.get("kinexa_access_token") or (credentials.credentials if credentials else None)
    if token is None:
        raise HTTPException(status_code=401, detail="Authentication required", headers={"WWW-Authenticate": "Bearer"})
    payload = decode_access_token(token)
    user = db.get(User, payload.get("sub"))
    if user is None or user.role != payload.get("role"):
        raise HTTPException(status_code=401, detail="Account is no longer available", headers={"WWW-Authenticate": "Bearer"})
    return user


def require_therapist(user: User = Depends(get_current_user)) -> User:
    if user.role != "therapist":
        raise HTTPException(status_code=403, detail="Therapist account required")
    return user


def require_owned_patient(patient_id: str, user: User, db: Session):
    from app.db import Patient

    patient = db.get(Patient, patient_id)
    if patient is None or patient.therapist_id != user.id:
        # Use the same response for missing and foreign records to avoid leaking IDs.
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


def require_patient_access(patient_id: str, user: User, db: Session):
    from app.db import Patient

    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    if user.role == "therapist" and patient.therapist_id == user.id:
        return patient
    if user.role == "patient" and user.patient_id == patient.id:
        return patient
    raise HTTPException(status_code=404, detail="Patient not found")
