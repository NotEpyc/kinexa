"""Video analysis endpoints."""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List
import uuid
import tempfile
import os
import shutil
import cv2
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.exercises.registry import get_exercise, supported_exercises
from app.models.loader import get_model_loader
from app.db import Analysis, ExercisePlan, Patient, PatientExerciseParameter, RepResultRecord, get_db
from app.advice import personalized_advice
from app.rules.engine import Metric, Parameter, Phase, Side

router = APIRouter()


class IssueDetail(BaseModel):
    code: str
    message: str
    severity: str


class RepResult(BaseModel):
    rep: int
    status: str  # "correct" | "incorrect" | "not_assessable"
    start_s: float
    bottom_s: float
    end_s: float
    measurements: dict
    ml: Optional[dict] = None
    issues: list[IssueDetail] = []
    advice: list[dict] = []


class AnalyzeResponse(BaseModel):
    analysis_id: str
    exercise: str
    model_version: str
    total_reps: int
    correct_reps: int
    incorrect_reps: int
    score: int
    reps: list[RepResult]
    warnings: list[str] = []


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_video(
    video: UploadFile = File(...),
    patient_id: str = Form(...),
    exercise: str = Form("squat"),
    db: Session = Depends(get_db),
):
    """
    Upload video + patient_id + exercise; returns per-rep analysis.
    
    Pipeline:
    1. Validate video (type, size, duration)
    2. Save to temp file
    3. Dispatch to the registered exercise pipeline (MediaPipe → angles → reps → features → rules)
    4. Apply decision table (rules override ML)
    5. Return structured JSON
    """
    # 1. Validate file type
    allowed_types = {"video/mp4", "video/quicktime", "video/webm"}
    if video.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: MP4, MOV, WebM. Got: {video.content_type}"
        )
    
    # Stream the upload to a temporary file while enforcing the size limit.
    max_size = 100 * 1024 * 1024  # 100 MB
    chunk_size = 1024 * 1024  # 1 MB
    safe_filename = os.path.basename(video.filename or "upload")
    temp_path = os.path.join(
        tempfile.gettempdir(), f"kinexa_{uuid.uuid4().hex}_{safe_filename}"
    )

    try:
        patient = db.get(Patient, patient_id)
        if patient is None:
            raise HTTPException(status_code=404, detail="Patient not found; create the patient before analyzing a video.")
        total_size = 0
        with open(temp_path, "wb") as temp_file:
            while True:
                chunk = await video.read(chunk_size)
                if not chunk:
                    break

                total_size += len(chunk)
                if total_size > max_size:
                    raise HTTPException(
                        status_code=400,
                        detail="File too large. Maximum size: 100 MB.",
                    )
                temp_file.write(chunk)

        # Validate that OpenCV can read the video and enforce the duration limit.
        cap = cv2.VideoCapture(temp_path)
        if not cap.isOpened():
            cap.release()
            raise HTTPException(status_code=400, detail="Uploaded file is not a readable video.")

        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            if fps > 0 and frame_count > 0:
                duration = frame_count / fps
                if duration > 60:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Video too long. Maximum duration: 60 seconds. Got: {duration:.1f} seconds",
                    )
        finally:
            cap.release()

        exercise_module = get_exercise(exercise)
        if exercise_module is None:
            raise HTTPException(
                status_code=400,
                detail=f"Exercise '{exercise}' is not implemented. Supported exercises: {', '.join(supported_exercises())}.",
            )

        # analyze.py -> routes -> app -> backend; model bundle is under backend/models.
        backend_root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        model_path = os.path.join(backend_root, "models", "pose_landmarker_full.task")
        if not os.path.isfile(model_path):
            raise HTTPException(
                status_code=500,
                detail="MediaPipe model not found at backend/models/pose_landmarker_full.task.",
            )
        
        exercise_analyzer = exercise_module.analyzer(model_path=model_path)
        plan = db.scalar(select(ExercisePlan).where(
            ExercisePlan.patient_id == patient_id,
            ExercisePlan.exercise == exercise,
            ExercisePlan.active.is_(True),
        ).order_by(ExercisePlan.created_at.desc()))
        active_parameters = list(db.scalars(select(PatientExerciseParameter).where(
            PatientExerciseParameter.plan_id == plan.id,
            PatientExerciseParameter.effective_to.is_(None),
            PatientExerciseParameter.effective_from <= datetime.now(timezone.utc),
        ))) if plan else []
        rule_parameters = [Parameter(
            id=item.id, plan_id=item.plan_id, metric=Metric(item.metric), side=Side(item.side), phase=Phase(item.phase),
            min_value=item.min_value, max_value=item.max_value, unit=item.unit, tolerance=item.tolerance,
            effective_from=item.effective_from.isoformat(), effective_to=None, version=item.version,
        ) for item in active_parameters]
        rules_engine = exercise_module.build_rules(patient_id, rule_parameters or None)
        
        # Run analysis
        result = exercise_analyzer.analyze_video(temp_path, rules_engine)
        
        # Check for no assessable reps
        if not result.reps:
            if result.total_frames == 0:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": "NO_PERSON_DETECTED",
                        "message": "No person detected in video. Ensure full body is visible, camera at hip height, side view.",
                        "warnings": result.warnings
                    }
                )
            elif result.frames and not result.reps:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": "NO_REPS_FOUND",
                        "message": f"No valid {exercise} reps detected. Check movement depth and form.",
                        "warnings": result.warnings
                    }
                )
        
        # Convert to response format
        rep_results = []
        correct_count = 0
        incorrect_count = 0
        
        for assessment in result.reps:
            # Build measurements dict
            measurements_dict = {}
            for m in assessment.measurements:
                key = f"{m.metric.value}_{m.side.value}_{m.phase.value}"
                measurements_dict[key] = {
                    "value": m.value,
                    "unit": m.unit
                }
            
            # Convert flags to issues (include codes)
            issues = []
            for flag in assessment.flags:
                issues.append({
                    "code": flag.code,
                    "message": flag.message,
                    "severity": flag.severity.value
                })
            
            # Determine status string
            status_map = {
                "pass": "correct",
                "flag": "incorrect",
                "advisory": "needs_attention",
                "not_assessable": "not_assessable"
            }
            status_str = status_map.get(assessment.status.value, "not_assessable")
            measured = [{
                "metric": item.metric.value, "side": item.side.value, "phase": item.phase.value,
                "value": item.value, "unit": item.unit,
            } for item in assessment.measurements]
            advice = personalized_advice(measured, active_parameters)
            
            if status_str == "correct":
                correct_count += 1
            elif status_str == "incorrect":
                incorrect_count += 1
            
            # Get timestamps from feature extraction (stored in assessment)
            rep_result = RepResult(
                rep=assessment.rep_index + 1,
                status=status_str,
                start_s=assessment.start_time,
                bottom_s=assessment.bottom_time,
                end_s=assessment.end_time,
                measurements=measurements_dict,
                ml=assessment.ml_output,
                issues=[IssueDetail(**issue) for issue in issues],
                advice=advice,
            )
            rep_results.append(rep_result)
        
        model_loader = get_model_loader()
        configured_quality_model = os.getenv("KINEXA_QUALITY_MODEL", "").strip()
        active_quality_model = (
            model_loader.metadata.version
            if model_loader.is_loaded and model_loader.metadata and model_loader.metadata.exercise == exercise
            else None
        )
        if configured_quality_model and active_quality_model is None:
            result.warnings.append(
                f"Configured quality model '{configured_quality_model}' could not be loaded; therapist ROM rules were used."
            )

        # Calculate score (percentage of correct reps)
        total = len(rep_results)
        score = int((correct_count / total * 100)) if total > 0 else 0
        
        analysis_id = str(uuid.uuid4())
        stored_analysis = Analysis(
            id=analysis_id, patient_id=patient_id, plan_id=plan.id if plan else None,
            exercise=exercise, source="upload",
            constraints_snapshot={"plan_id": plan.id if plan else None, "parameters": [
                {"id": p.id, "metric": p.metric, "side": p.side, "phase": p.phase,
                 "min_value": p.min_value, "max_value": p.max_value, "unit": p.unit,
                 "tolerance": p.tolerance, "version": p.version}
                for p in active_parameters
            ]},
            model_version=active_quality_model or f"{exercise}_rules_v0", score=score,
            total_reps=total, correct_reps=correct_count, incorrect_reps=incorrect_count,
            warnings=result.warnings,
        )
        stored_analysis.reps = [RepResultRecord(
            rep_index=rep.rep, status=rep.status, start_s=rep.start_s, bottom_s=rep.bottom_s, end_s=rep.end_s,
            measurements=rep.measurements, ml_output=rep.ml, issues=[item.model_dump() for item in rep.issues], advice=rep.advice,
        ) for rep in rep_results]
        db.add(stored_analysis)
        db.commit()

        return AnalyzeResponse(
            analysis_id=analysis_id,
            exercise=exercise,
            model_version=active_quality_model or f"{exercise}_rules_v0",
            total_reps=total,
            correct_reps=correct_count,
            incorrect_reps=incorrect_count,
            score=score,
            reps=rep_results,
            warnings=result.warnings,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(e)}"
        )
    finally:
        # Cleanup temp file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass


def _analysis_json(record: Analysis) -> dict:
    return {
        "analysis_id": record.id, "patient_id": record.patient_id, "plan_id": record.plan_id,
        "exercise": record.exercise, "source": record.source, "model_version": record.model_version,
        "score": record.score, "total_reps": record.total_reps, "correct_reps": record.correct_reps,
        "incorrect_reps": record.incorrect_reps, "created_at": record.created_at.isoformat(),
        "constraints_snapshot": record.constraints_snapshot, "warnings": record.warnings,
        "reps": [{
            "rep": item.rep_index, "status": item.status, "start_s": item.start_s,
            "bottom_s": item.bottom_s, "end_s": item.end_s, "measurements": item.measurements,
            "ml": item.ml_output, "issues": item.issues, "advice": item.advice,
        } for item in record.reps],
    }


@router.get("/analyses/{analysis_id}")
def get_analysis(analysis_id: str, db: Session = Depends(get_db)):
    """Fetch a stored analysis and its rep-level results."""
    record = db.get(Analysis, analysis_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return _analysis_json(record)


@router.get("/patients/{patient_id}/analyses")
def get_patient_analyses(patient_id: str, db: Session = Depends(get_db)):
    """Return stored upload and live-session history for a patient."""
    if db.get(Patient, patient_id) is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    records = db.scalars(select(Analysis).where(Analysis.patient_id == patient_id).order_by(Analysis.created_at.desc()))
    return [_analysis_json(record) for record in records]


class LiveRepInput(BaseModel):
    rep: int = Field(ge=1)
    status: str
    start_s: float = 0
    bottom_s: float = 0
    end_s: float = 0
    measurements: dict = Field(default_factory=dict)
    ml: dict | None = None
    issues: list = Field(default_factory=list)
    advice: list = Field(default_factory=list)


class LiveSessionInput(BaseModel):
    patient_id: str
    exercise: str
    model_version: str = "browser_rules_v1"
    score: int = Field(ge=0, le=100)
    total_reps: int = Field(ge=0)
    correct_reps: int = Field(ge=0)
    incorrect_reps: int = Field(ge=0)
    constraints_snapshot: dict = Field(default_factory=dict)
    reps: list[LiveRepInput] = Field(default_factory=list)


@router.post("/live-sessions", status_code=201)
def save_live_session(request: LiveSessionInput, db: Session = Depends(get_db)):
    patient = db.get(Patient, request.patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    plan = db.scalar(select(ExercisePlan).where(
        ExercisePlan.patient_id == request.patient_id,
        ExercisePlan.exercise == request.exercise,
        ExercisePlan.active.is_(True),
    ).order_by(ExercisePlan.created_at.desc()))
    record = Analysis(
        patient_id=request.patient_id, plan_id=plan.id if plan else None,
        exercise=request.exercise, source="live", model_version=request.model_version,
        score=request.score, total_reps=request.total_reps, correct_reps=request.correct_reps,
        incorrect_reps=request.incorrect_reps, constraints_snapshot=request.constraints_snapshot,
    )
    record.reps = [RepResultRecord(
        rep_index=item.rep, status=item.status, start_s=item.start_s, bottom_s=item.bottom_s,
        end_s=item.end_s, measurements=item.measurements, ml_output=item.ml,
        issues=item.issues, advice=item.advice,
    ) for item in request.reps]
    db.add(record)
    db.commit()
    return {"analysis_id": record.id, "patient_id": record.patient_id, "saved_reps": len(record.reps)}
