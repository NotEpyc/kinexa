"""Persistent patient management endpoints."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import Patient, get_db

router = APIRouter()


class PatientCreate(BaseModel):
    therapist_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    age: Optional[int] = Field(default=None, ge=0, le=130)
    notes: Optional[str] = None


class PatientUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    age: Optional[int] = Field(default=None, ge=0, le=130)
    notes: Optional[str] = None


class PatientResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    therapist_id: str
    name: str
    age: Optional[int]
    notes: Optional[str]
    created_at: datetime


@router.post("/patients", response_model=PatientResponse, status_code=201)
def create_patient(patient: PatientCreate, db: Session = Depends(get_db)):
    record = Patient(**patient.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/patients/{patient_id}", response_model=PatientResponse)
def get_patient(patient_id: str, db: Session = Depends(get_db)):
    record = db.get(Patient, patient_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    return record


@router.put("/patients/{patient_id}", response_model=PatientResponse)
def update_patient(patient_id: str, patient: PatientUpdate, db: Session = Depends(get_db)):
    record = db.get(Patient, patient_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    for key, value in patient.model_dump(exclude_unset=True).items():
        setattr(record, key, value)
    db.commit()
    db.refresh(record)
    return record


@router.get("/patients", response_model=list[PatientResponse])
def list_patients(therapist_id: Optional[str] = None, db: Session = Depends(get_db)):
    statement = select(Patient).order_by(Patient.created_at.desc())
    if therapist_id:
        statement = statement.where(Patient.therapist_id == therapist_id)
    return list(db.scalars(statement))
