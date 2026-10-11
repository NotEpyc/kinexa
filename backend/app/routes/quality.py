"""Exercise-model inference endpoints for live, feature-only assessment."""

import math
import os
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.features.registry import EXERCISE_FEATURE_SCHEMAS, get_feature_schema
from app.models.loader import get_model_loader

router = APIRouter()


class QualityAssessmentRequest(BaseModel):
    exercise: str = Field(min_length=1, max_length=40)
    features: dict[str, float]


@router.get("/quality/exercises")
async def available_exercises() -> dict[str, list[dict[str, Any]]]:
    """Expose registered feature contracts so clients can discover supported models."""
    loader = get_model_loader()
    exercises = []
    for schema in EXERCISE_FEATURE_SCHEMAS.values():
        model_version = os.getenv("KINEXA_QUALITY_MODEL", "").strip() or schema.default_model_version
        available = loader.load(model_version)
        model_matches = bool(available and loader.metadata and loader.metadata.exercise == schema.exercise)
        validation = loader.metadata.camera_validation if model_matches and loader.metadata else None
        camera_validated = bool(
            validation
            and validation.get("status") == "passed"
            and validation.get("validation_domain") == "mediapipe_live"
            and validation.get("subject_independent") is True
            and isinstance(validation.get("therapist_agreement_percent"), (int, float))
            and validation["therapist_agreement_percent"] >= 80
        )
        readiness = "camera_validated" if camera_validated else "model_advisory" if model_matches else "rules_only"
        readiness_reason = (
            "Camera validation metadata passed subject-independent checks and reports at least 80% therapist agreement."
            if camera_validated
            else "The available model has not passed documented subject-independent validation on MediaPipe camera data."
            if model_matches
            else "No compatible quality model is installed; exercise checks use rules only."
        )
        exercises.append({
            "exercise": schema.exercise,
            "feature_schema_version": schema.version,
            "feature_names": list(schema.feature_names),
            "default_model_version": schema.default_model_version,
            "model_available": model_matches,
            "readiness": readiness,
            "readiness_reason": readiness_reason,
            "source_datasets": loader.metadata.source_datasets if model_matches and loader.metadata else [],
            "camera_validation": validation,
        })
    return {"exercises": exercises}


@router.post("/quality/assess")
async def assess_quality(request: QualityAssessmentRequest) -> dict[str, Any]:
    """Return an advisory model result for one rep's canonical feature vector.

    Live camera frames stay in the browser. Only the derived feature values are
    sent here. Therapist ROM rules remain the authoritative decision layer.
    """
    try:
        schema = get_feature_schema(request.exercise)
    except ValueError as exc:
        return {"available": False, "reason": str(exc), "exercise": request.exercise}

    expected = set(schema.feature_names)
    supplied = set(request.features)
    missing = sorted(expected - supplied)
    unexpected = sorted(supplied - expected)
    if missing or unexpected:
        details = []
        if missing:
            details.append(f"missing features: {', '.join(missing)}")
        if unexpected:
            details.append(f"unexpected features: {', '.join(unexpected)}")
        return {"available": False, "reason": "; ".join(details), "exercise": request.exercise}
    if not all(math.isfinite(value) for value in request.features.values()):
        return {"available": False, "reason": "feature values must be finite numbers", "exercise": request.exercise}

    loader = get_model_loader()
    requested_version = os.getenv("KINEXA_QUALITY_MODEL", "").strip() or schema.default_model_version
    if not loader.load(requested_version):
        return {
            "available": False,
            "reason": f"quality model '{requested_version}' is not installed",
            "exercise": request.exercise,
        }
    if loader.metadata is None or loader.metadata.exercise != request.exercise:
        return {
            "available": False,
            "reason": f"quality model '{requested_version}' does not support {request.exercise}",
            "exercise": request.exercise,
        }

    try:
        assessment = loader.assess(request.features)
    except (RuntimeError, ValueError) as exc:
        return {"available": False, "reason": str(exc), "exercise": request.exercise}
    if assessment is None:
        return {"available": False, "reason": "quality model metadata is unavailable", "exercise": request.exercise}

    return {
        "available": True,
        "exercise": request.exercise,
        "model_version": loader.metadata.version,
        "metrics": loader.metadata.metrics,
        "assessment": assessment,
        "scope": "research advisory; therapist-set ROM rules take precedence",
    }
