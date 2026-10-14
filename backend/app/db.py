"""Database configuration and SQLAlchemy persistence models."""

import os
from datetime import datetime, timezone
from typing import Generator
from uuid import uuid4

from fastapi import HTTPException
from dotenv import load_dotenv
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


load_dotenv()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/kinexa"
)
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    therapist_id: Mapped[str] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(200))
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    plans: Mapped[list["ExercisePlan"]] = relationship(back_populates="patient", cascade="all, delete-orphan")
    analyses: Mapped[list["Analysis"]] = relationship(back_populates="patient")


class ExercisePlan(Base):
    __tablename__ = "exercise_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    exercise: Mapped[str] = mapped_column(String(40), index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    patient: Mapped[Patient] = relationship(back_populates="plans")
    parameters: Mapped[list["PatientExerciseParameter"]] = relationship(back_populates="plan", cascade="all, delete-orphan")


class PatientExerciseParameter(Base):
    __tablename__ = "patient_exercise_parameters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    plan_id: Mapped[str] = mapped_column(ForeignKey("exercise_plans.id", ondelete="CASCADE"), index=True)
    metric: Mapped[str] = mapped_column(String(60))
    side: Mapped[str] = mapped_column(String(12), default="either")
    phase: Mapped[str] = mapped_column(String(20), default="at_bottom")
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(20))
    tolerance: Mapped[float | None] = mapped_column(Float, nullable=True)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    plan: Mapped[ExercisePlan] = relationship(back_populates="parameters")


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    plan_id: Mapped[str | None] = mapped_column(ForeignKey("exercise_plans.id", ondelete="SET NULL"), nullable=True)
    exercise: Mapped[str] = mapped_column(String(40), index=True)
    source: Mapped[str] = mapped_column(String(20), default="upload")
    constraints_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    video_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_version: Mapped[str] = mapped_column(String(100))
    score: Mapped[int] = mapped_column(Integer, default=0)
    total_reps: Mapped[int] = mapped_column(Integer, default=0)
    correct_reps: Mapped[int] = mapped_column(Integer, default=0)
    incorrect_reps: Mapped[int] = mapped_column(Integer, default=0)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    patient: Mapped[Patient] = relationship(back_populates="analyses")
    reps: Mapped[list["RepResultRecord"]] = relationship(back_populates="analysis", cascade="all, delete-orphan")


class RepResultRecord(Base):
    __tablename__ = "rep_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    rep_index: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24))
    start_s: Mapped[float] = mapped_column(Float, default=0)
    bottom_s: Mapped[float] = mapped_column(Float, default=0)
    end_s: Mapped[float] = mapped_column(Float, default=0)
    measurements: Mapped[dict] = mapped_column(JSON, default=dict)
    ml_output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    issues: Mapped[list] = mapped_column(JSON, default=list)
    advice: Mapped[list] = mapped_column(JSON, default=list)
    analysis: Mapped[Analysis] = relationship(back_populates="reps")


def get_db() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Database operation failed; verify PostgreSQL is running and DATABASE_URL is correct.") from exc
    finally:
        session.close()
