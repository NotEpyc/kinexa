"""Health check endpoints."""

import os

from fastapi import APIRouter
from app.features.registry import get_feature_schema
from app.models.loader import get_model_loader

router = APIRouter()


@router.get("/health")
async def health_check():
    """Service and model-version status."""
    loader = get_model_loader()
    active_exercise = os.getenv("KINEXA_ACTIVE_EXERCISE", "squat").strip()
    try:
        schema = get_feature_schema(active_exercise)
        default_model = schema.default_model_version
    except ValueError:
        default_model = f"{active_exercise}_rf_v1"
    configured_model = os.getenv("KINEXA_QUALITY_MODEL", "").strip() or default_model
    loader.load(configured_model)
    model = loader.metadata if loader.is_loaded else None
    return {
        "status": "healthy",
        "model_version": model.version if model else f"{active_exercise}_rules_v0",
        "quality_model_loaded": model is not None,
        "quality_model_exercise": model.exercise if model else None,
        "service": "kinexa",
    }
