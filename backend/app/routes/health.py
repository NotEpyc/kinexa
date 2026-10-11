"""Health check endpoints."""

from fastapi import APIRouter
from app.models.loader import get_model_loader

router = APIRouter()


@router.get("/health")
async def health_check():
    """Service and model-version status."""
    loader = get_model_loader()
    model = loader.metadata if loader.is_loaded else None
    return {
        "status": "healthy",
        "model_version": model.version if model else "squat_rules_v0",
        "quality_model_loaded": model is not None,
        "quality_model_exercise": model.exercise if model else None,
        "service": "kinexa",
    }
