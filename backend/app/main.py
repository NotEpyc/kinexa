"""Kinexa FastAPI Application Entry Point."""

from pathlib import Path
import logging
from contextlib import asynccontextmanager
from sqlalchemy.exc import SQLAlchemyError

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routes import analyze, patients, plans, health, quality, auth
from app.db import Base, engine

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Create the v1 schema automatically for a fresh local PostgreSQL database.
    # A missing DB should not prevent the camera-only experience from starting.
    try:
        Base.metadata.create_all(bind=engine)
    except SQLAlchemyError:
        logger.exception("PostgreSQL unavailable; persistence endpoints will return 503 until it is configured")
    yield

app = FastAPI(
    title="Kinexa API",
    description="Explainable Exercise Form Assessment Platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The browser live-session client loads the same pose bundle used by the API.
model_dir = Path(__file__).resolve().parents[1] / "models"
if model_dir.is_dir():
    app.mount("/api/models", StaticFiles(directory=model_dir), name="models")

# Routers
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(auth.router, prefix="/api", tags=["authentication"])
app.include_router(analyze.router, prefix="/api", tags=["analyze"])
app.include_router(patients.router, prefix="/api", tags=["patients"])
app.include_router(plans.router, prefix="/api", tags=["plans"])
app.include_router(quality.router, prefix="/api", tags=["quality-model"])


@app.get("/")
async def root():
    return {"service": "kinexa", "version": "0.1.0", "status": "running"}
