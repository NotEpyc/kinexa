"""Patient management endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

router = APIRouter()


class PatientCreate(BaseModel):
    therapist_id: str
    name: str
    age: Optional[int] = None
    notes: Optional[str] = None


class PatientUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    notes: Optional[str] = None


class PatientResponse(BaseModel):
    id: str
    therapist_id: str
    name: str
    age: Optional[int]
    notes: Optional[str]
    created_at: datetime


@router.post("/patients", response_model=PatientResponse, status_code=201)
async def create_patient(patient: PatientCreate):
    """Create a new patient."""
    # TODO: Insert into PostgreSQL
    return PatientResponse(
        id=str(uuid.uuid4())[:8],
        therapist_id=patient.therapist_id,
        name=patient.name,
        age=patient.age,
        notes=patient.notes,
        created_at=datetime.utcnow(),
    )


@router.get("/patients/{patient_id}", response_model=PatientResponse)
async def get_patient(patient_id: str):
    """Get patient by ID."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.put("/patients/{patient_id}", response_model=PatientResponse)
async def update_patient(patient_id: str, patient: PatientUpdate):
    """Update patient."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/patients")
async def list_patients(therapist_id: Optional[str] = None):
    """List patients (filtered by therapist if provided)."""
    raise HTTPException(status_code=501, detail="Not implemented")