"""Exercise plan and ROM parameter endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime
import uuid

router = APIRouter()


# Exercise Plan
class PlanCreate(BaseModel):
    patient_id: str
    exercise: str = "squat"
    active: bool = True


class PlanResponse(BaseModel):
    id: str
    patient_id: str
    exercise: str
    active: bool
    created_at: datetime


@router.post("/patients/{patient_id}/plans", response_model=PlanResponse, status_code=201)
async def create_plan(patient_id: str, plan: PlanCreate):
    """Create an exercise plan for a patient."""
    if plan.patient_id != patient_id:
        raise HTTPException(status_code=400, detail="patient_id mismatch")
    # TODO: Insert into PostgreSQL
    return PlanResponse(
        id=str(uuid.uuid4())[:8],
        patient_id=plan.patient_id,
        exercise=plan.exercise,
        active=plan.active,
        created_at=datetime.utcnow(),
    )


@router.get("/patients/{patient_id}/plans")
async def list_plans(patient_id: str):
    """List exercise plans for a patient."""
    raise HTTPException(status_code=501, detail="Not implemented")


# Patient Exercise Parameters (ROM constraints)
class ParameterCreate(BaseModel):
    plan_id: str
    metric: str = Field(..., description="e.g., knee_angle, trunk_lean, asymmetry, tempo")
    side: Literal["left", "right", "either"]
    phase: Literal["at_bottom", "at_peak", "whole_rep"]
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    unit: str = Field(..., description="deg, %, s")
    tolerance: Optional[float] = None
    effective_from: datetime
    effective_to: Optional[datetime] = None
    version: int = 1


class ParameterUpdate(BaseModel):
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    tolerance: Optional[float] = None
    effective_to: Optional[datetime] = None
    version: Optional[int] = None


class ParameterResponse(BaseModel):
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


@router.post("/patients/{patient_id}/plans/{plan_id}/parameters", response_model=ParameterResponse, status_code=201)
async def create_parameter(patient_id: str, plan_id: str, param: ParameterCreate):
    """Create a ROM parameter for an exercise plan."""
    # TODO: Verify plan belongs to patient, then insert
    return ParameterResponse(
        id=str(uuid.uuid4())[:8],
        plan_id=param.plan_id,
        metric=param.metric,
        side=param.side,
        phase=param.phase,
        min_value=param.min_value,
        max_value=param.max_value,
        unit=param.unit,
        tolerance=param.tolerance,
        effective_from=param.effective_from,
        effective_to=param.effective_to,
        version=param.version,
    )


@router.get("/patients/{patient_id}/plans/{plan_id}/parameters")
async def list_parameters(patient_id: str, plan_id: str):
    """List ROM parameters for a plan."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.put("/patients/{patient_id}/plans/{plan_id}/parameters/{param_id}", response_model=ParameterResponse)
async def update_parameter(patient_id: str, plan_id: str, param_id: str, param: ParameterUpdate):
    """Update a ROM parameter (creates new version)."""
    raise HTTPException(status_code=501, detail="Not implemented")