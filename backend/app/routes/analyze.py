"""Video analysis endpoints."""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import uuid
import tempfile
import os
import shutil
import cv2

from app.exercises.squat import SquatExercise
from app.rules.engine import RulesEngine, Parameter, Metric, Side, Phase
from app.models.loader import get_model_loader

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


def _build_rules_engine(patient_id: str, exercise: str) -> RulesEngine:
    """
    Build RulesEngine from patient_exercise_parameters.
    TODO: Replace with actual DB query.
    For now, return default population limits.
    """
    # Default population limits for squat
    defaults = [
        Parameter(
            id="default_knee_min",
            plan_id="default",
            metric="knee_angle",
            side="either",
            phase="at_bottom",
            min_value=90.0,
            max_value=None,
            unit="deg",
            tolerance=5.0,
            effective_from="2024-01-01T00:00:00",
            effective_to=None,
            version=1,
        ),
        Parameter(
            id="default_knee_max",
            plan_id="default",
            metric="knee_angle",
            side="either",
            phase="at_bottom",
            min_value=None,
            max_value=130.0,
            unit="deg",
            tolerance=5.0,
            effective_from="2024-01-01T00:00:00",
            effective_to=None,
            version=1,
        ),
        Parameter(
            id="default_trunk_max",
            plan_id="default",
            metric="trunk_lean",
            side="either",
            phase="at_bottom",
            min_value=None,
            max_value=25.0,
            unit="deg",
            tolerance=3.0,
            effective_from="2024-01-01T00:00:00",
            effective_to=None,
            version=1,
        ),
        Parameter(
            id="default_asym_max",
            plan_id="default",
            metric="asymmetry",
            side="either",
            phase="at_bottom",
            min_value=None,
            max_value=10.0,
            unit="deg",
            tolerance=2.0,
            effective_from="2024-01-01T00:00:00",
            effective_to=None,
            version=1,
        ),
    ]
    return RulesEngine(defaults)


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_video(
    video: UploadFile = File(...),
    patient_id: str = Form(...),
    exercise: str = Form("squat"),
):
    """
    Upload video + patient_id + exercise; returns per-rep analysis.
    
    Pipeline:
    1. Validate video (type, size, duration)
    2. Save to temp file
    3. Run squat analysis pipeline (MediaPipe → angles → reps → features → rules)
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
    
    # 2. Check file size (max 100 MB) - read in chunks to avoid loading entire file
    max_size = 100 * 1024 * 1024  # 100 MB
    content = bytearray()
    chunk_size = 1024 * 1024  # 1 MB chunks
    while True:
    # 2. Stream upload to temp file with size check

    max_size = 100 * 1024 * 1024  # 100 MB

    temp_dir = tempfile.gettempdir()

    temp_path = os.path.join(temp_dir, f"kinexa_{uuid.uuid4().hex}_{video.filename}")



    try:

        total_size = 0

        chunk_size = 1024 * 1024  # 1 MB

        with open(temp_path, "wb") as f:

            while True:

                chunk = await video.read(chunk_size)

                if not chunk:

                    break

                f.write(chunk)

                total_size += len(chunk)

                if total_size > max_size:

                    raise HTTPException(

                        status_code=400,

                        detail=f"File too large. Maximum size: 100 MB. Got: {total_size / (1024*1024):.1f} MB"

                    )



        # 3. Validate video duration (max 60 seconds) - quick check via OpenCV

        cap = cv2.VideoCapture(temp_path)

        if cap.isOpened():

            fps = cap.get(cv2.CAP_PROP_FPS)

            frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)

            if fps > 0 and frame_count > 0:

                duration = frame_count / fps

                if duration > 60:

                    cap.release()

                    raise HTTPException(

                        status_code=400,

                        detail=f"Video too long. Maximum duration: 60 seconds. Got: {duration:.1f} seconds"

                    )

            cap.release()

            )
        
        # Initialize pipeline
        # Model is at project_root/backend/models/pose_landmarker_full.task
        # __file__ = backend/app/routes/analyze.py
        # Need to go up 3 levels: routes -> app -> backend -> project_root
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        model_path = os.path.join(project_root, "models", "pose_landmarker_full.task")
        
        squat_exercise = SquatExercise(model_path=model_path)
        rules_engine = _build_rules_engine(patient_id, exercise)
        
        # Run analysis
        result = squat_exercise.analyze_video(temp_path, rules_engine)
        
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
                        "message": "No valid reps detected. Check squat depth and form.",
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
                issues=[i["message"] for i in issues]
            )
            rep_results.append(rep_result)
        
        # Calculate score (percentage of correct reps)
        total = len(rep_results)
        score = int((correct_count / total * 100)) if total > 0 else 0
        
        return AnalyzeResponse(
            analysis_id=str(uuid.uuid4())[:8],
            exercise=exercise,
            model_version="squat_rules_v0",  # Rules-first, no ML yet
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


@router.get("/analyses/{analysis_id}")
async def get_analysis(analysis_id: str):
    """Fetch a stored analysis."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/patients/{patient_id}/analyses")
async def get_patient_analyses(patient_id: str):
    """History for a patient."""
    raise HTTPException(status_code=501, detail="Not implemented")