"""Persistent exercise plans and versioned therapist ROM parameters."""

from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import ExercisePlan, Patient, PatientExerciseParameter, get_db

router = APIRouter()


class PlanCreate(BaseModel):
    patient_id: str
    exercise: str = Field(default="squat", min_length=1, max_length=40)
    active: bool = True


class PlanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    patient_id: str
    exercise: str
    active: bool
    created_at: datetime


@router.post("/patients/{patient_id}/plans", response_model=PlanResponse, status_code=201)
def create_plan(patient_id: str, plan: PlanCreate, db: Session = Depends(get_db)):
    if plan.patient_id != patient_id:
        raise HTTPException(status_code=400, detail="patient_id mismatch")
    if db.get(Patient, patient_id) is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    if plan.active:
        for previous in db.scalars(select(ExercisePlan).where(
            ExercisePlan.patient_id == patient_id,
            ExercisePlan.exercise == plan.exercise,
            ExercisePlan.active.is_(True),
        )):
            previous.active = False
    record = ExercisePlan(patient_id=patient_id, exercise=plan.exercise, active=plan.active)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/patients/{patient_id}/plans", response_model=list[PlanResponse])
def list_plans(patient_id: str, db: Session = Depends(get_db)):
    if db.get(Patient, patient_id) is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    return list(db.scalars(select(ExercisePlan).where(
        ExercisePlan.patient_id == patient_id
    ).order_by(ExercisePlan.created_at.desc())))


class ParameterCreate(BaseModel):
    plan_id: str
    metric: str = Field(min_length=1, max_length=60)
    side: Literal["left", "right", "either"] = "either"
    phase: Literal["at_bottom", "at_peak", "whole_rep"] = "at_bottom"
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    unit: str = Field(min_length=1, max_length=20)
    tolerance: Optional[float] = Field(default=None, ge=0)
    effective_from: Optional[datetime] = None
    effective_to: Optional[datetime] = None
    version: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def has_limit(self):
        if self.min_value is None and self.max_value is None:
            raise ValueError("At least one of min_value or max_value is required")
        if self.min_value is not None and self.max_value is not None and self.min_value > self.max_value:
            raise ValueError("min_value must not exceed max_value")
        return self


class ParameterUpdate(BaseModel):
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    tolerance: Optional[float] = Field(default=None, ge=0)
    effective_to: Optional[datetime] = None


class ParameterResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    plan_id: str
    metric: str
    side: str
    phase: str
    min_value: Optional[float]
    max_value: Optional[float]
    unit: str
    tolerance: Optional[float]
    effective_from: datetime
    effective_to: Optional[datetime]
    version: int


def _owned_plan(patient_id: str, plan_id: str, db: Session) -> ExercisePlan:
    plan = db.scalar(select(ExercisePlan).where(
        ExercisePlan.id == plan_id, ExercisePlan.patient_id == patient_id
    ))
    if plan is None:
        raise HTTPException(status_code=404, detail="Exercise plan not found for this patient")
    return plan


@router.post("/patients/{patient_id}/plans/{plan_id}/parameters", response_model=ParameterResponse, status_code=201)
def create_parameter(patient_id: str, plan_id: str, param: ParameterCreate, db: Session = Depends(get_db)):
    _owned_plan(patient_id, plan_id, db)
    if param.plan_id != plan_id:
        raise HTTPException(status_code=400, detail="plan_id mismatch")
    values = param.model_dump(exclude={"plan_id"})
    values["effective_from"] = values["effective_from"] or datetime.now(timezone.utc)
    record = PatientExerciseParameter(plan_id=plan_id, **values)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/patients/{patient_id}/plans/{plan_id}/parameters", response_model=list[ParameterResponse])
def list_parameters(patient_id: str, plan_id: str, db: Session = Depends(get_db)):
    _owned_plan(patient_id, plan_id, db)
    return list(db.scalars(select(PatientExerciseParameter).where(
        PatientExerciseParameter.plan_id == plan_id
    ).order_by(PatientExerciseParameter.metric, PatientExerciseParameter.side, PatientExerciseParameter.effective_from)))


@router.put("/patients/{patient_id}/plans/{plan_id}/parameters/{param_id}", response_model=ParameterResponse)
def update_parameter(patient_id: str, plan_id: str, param_id: str, param: ParameterUpdate, db: Session = Depends(get_db)):
    _owned_plan(patient_id, plan_id, db)
    current = db.scalar(select(PatientExerciseParameter).where(
        PatientExerciseParameter.id == param_id,
        PatientExerciseParameter.plan_id == plan_id,
    ))
    if current is None:
        raise HTTPException(status_code=404, detail="Parameter not found")
    changes = param.model_dump(exclude_unset=True)
    if not changes:
        return current
    next_min = changes.get("min_value", current.min_value)
    next_max = changes.get("max_value", current.max_value)
    if next_min is not None and next_max is not None and next_min > next_max:
        raise HTTPException(status_code=422, detail="min_value must not exceed max_value")
    now = datetime.now(timezone.utc)
    current.effective_to = changes.pop("effective_to", None) or now
    new_record = PatientExerciseParameter(
        plan_id=current.plan_id,
        metric=current.metric,
        side=current.side,
        phase=current.phase,
        min_value=changes.get("min_value", current.min_value),
        max_value=changes.get("max_value", current.max_value),
        unit=current.unit,
        tolerance=changes.get("tolerance", current.tolerance),
        effective_from=now,
        version=current.version + 1,
    )
    db.add(new_record)
    db.commit()
    db.refresh(new_record)
    return new_record
