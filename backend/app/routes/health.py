"""Health check endpoints."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check():
    """Service and model-version status."""
    return {
        "status": "healthy",
        "model_version": "squat_rf_v0",  # placeholder
        "service": "kinexa",
    }