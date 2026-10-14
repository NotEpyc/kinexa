"""Persistent patient management endpoints."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import Patient, User, get_db
from app.security import require_owned_patient, require_patient_access, require_therapist, get_current_user, hash_password

router = APIRouter()


class PatientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    age: Optional[int] = Field(default=None, ge=0, le=130)
    notes: Optional[str] = None


class PatientUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    age: Optional[int] = Field(default=None, ge=0, le=130)
    notes: Optional[str] = None


class PatientAccountCreate(BaseModel):
    email: str = Field(min_length=5, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=12, max_length=128)


class PatientResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    therapist_id: str
    name: str
    age: Optional[int]
    notes: Optional[str]
    created_at: datetime


@router.post("/patients", response_model=PatientResponse, status_code=201)
def create_patient(patient: PatientCreate, db: Session = Depends(get_db), user: User = Depends(require_therapist)):
    record = Patient(therapist_id=user.id, **patient.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/patients/{patient_id}", response_model=PatientResponse)
def get_patient(patient_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    record = require_patient_access(patient_id, user, db)
    return record


@router.put("/patients/{patient_id}", response_model=PatientResponse)
def update_patient(patient_id: str, patient: PatientUpdate, db: Session = Depends(get_db), user: User = Depends(require_therapist)):
    record = require_owned_patient(patient_id, user, db)
    for key, value in patient.model_dump(exclude_unset=True).items():
        setattr(record, key, value)
    db.commit()
    db.refresh(record)
    return record


@router.get("/patients", response_model=list[PatientResponse])
def list_patients(db: Session = Depends(get_db), user: User = Depends(require_therapist)):
    statement = select(Patient).where(Patient.therapist_id == user.id).order_by(Patient.created_at.desc())
    return list(db.scalars(statement))


@router.post("/patients/{patient_id}/account", status_code=201)
def create_patient_account(patient_id: str, request: PatientAccountCreate, db: Session = Depends(get_db), user: User = Depends(require_therapist)):
    patient = require_owned_patient(patient_id, user, db)
    if db.scalar(select(User.id).where(User.patient_id == patient.id)):
        raise HTTPException(status_code=409, detail="This patient already has a login account")
    email = request.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    account = User(email=email, name=patient.name, role="patient", patient_id=patient.id, password_hash=hash_password(request.password))
    db.add(account)
    db.commit()
    return {"account_created": True, "email": account.email, "patient_id": patient.id}
