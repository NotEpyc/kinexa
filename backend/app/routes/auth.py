"""Therapist account registration and JWT sign-in."""

import os

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import User, get_db
from app.security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter()
COOKIE_NAME = "kinexa_access_token"


def _set_access_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME, token, max_age=1800, httponly=True,
        secure=os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true",
        samesite="strict", path="/api",
    )


class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


def _account_response(user: User) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "patient_id": user.patient_id}


@router.post("/auth/register/therapist", status_code=201)
def register_therapist(request: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    if db.scalar(select(User.id).where(func.lower(User.email) == request.email.lower())):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(email=request.email.lower(), name=request.name.strip(), role="therapist", password_hash=hash_password(request.password))
    db.add(user)
    db.flush()
    token = create_access_token(user)
    db.commit()
    db.refresh(user)
    _set_access_cookie(response, token)
    return {"token_type": "bearer", "expires_in": 1800, "user": _account_response(user)}


@router.post("/auth/login")
def login(request: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(func.lower(User.email) == request.email.lower()))
    if user is None or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect", headers={"WWW-Authenticate": "Bearer"})
    _set_access_cookie(response, create_access_token(user))
    return {"token_type": "bearer", "expires_in": 1800, "user": _account_response(user)}


@router.post("/auth/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/api", httponly=True, samesite="strict")
    return response


@router.get("/auth/me")
def current_account(user: User = Depends(get_current_user)):
    return _account_response(user)


@router.post("/auth/change-password")
def change_password(request: ChangePasswordRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not verify_password(request.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(request.new_password)
    db.commit()
    return {"password_changed": True, "message": "Password updated. Your current session remains active."}
