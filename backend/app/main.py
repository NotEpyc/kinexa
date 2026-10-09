"""Kinexa FastAPI Application Entry Point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import analyze, patients, plans, health

app = FastAPI(
    title="Kinexa API",
    description="Explainable Exercise Form Assessment Platform",
    version="0.1.0",
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(analyze.router, prefix="/api", tags=["analyze"])
app.include_router(patients.router, prefix="/api", tags=["patients"])
app.include_router(plans.router, prefix="/api", tags=["plans"])


@app.get("/")
async def root():
    return {"service": "kinexa", "version": "0.1.0", "status": "running"}