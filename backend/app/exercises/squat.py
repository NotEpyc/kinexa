"""Squat exercise logic: landmarks, angles, reps, features, rules."""

from dataclasses import dataclass
from typing import List, Optional
import numpy as np

from ..pose import (
    PoseExtractor,
    extract_landmarks,
    calculate_knee_angle,
    calculate_hip_angle,
    calculate_trunk_lean,
    LANDMARKS,
)
from ..features.squat import (
    extract_squat_features,
    SquatFeatures,
    detect_reps,
)
from ..rules.engine import (
    RulesEngine,
    Parameter,
    Measurement,
    RepAssessment,
    Verdict,
    Metric,
    Side,
    Phase,
)


@dataclass
class FrameData:
    """Per-frame angle data."""
    frame_idx: int
    timestamp: float
    left_knee: float
    right_knee: float
    left_hip: float
    right_hip: float
    trunk_lean: float
    left_knee_vis: float
    right_knee_vis: float
    left_hip_vis: float
    right_hip_vis: float


@dataclass
class SquatAnalysisResult:
    """Complete squat analysis result."""
    total_frames: int
    fps: float
    frames: List[FrameData]
    reps: List[RepAssessment]
    warnings: List[str]


class SquatExercise:
    """
    Squat exercise analysis pipeline.
    
    Pipeline:
    1. MediaPipe pose extraction (every frame)
    2. Angle computation (knee, hip, trunk lean)
    3. Rep detection (valley detection on knee angle)
    4. Feature extraction per rep
    5. Rules evaluation (therapist ROM limits)
    6. ML model inference (optional)
    7. Decision layer (rules override ML)
    """
    
    # Required landmarks for squat analysis
    REQUIRED_LANDMARKS = [
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
        'left_ankle', 'right_ankle',
        'left_shoulder', 'right_shoulder',
    ]
    
    # Visibility threshold for landmark reliability
    VISIBILITY_THRESHOLD = 0.5
    
    def __init__(self, model_path: str = 'pose_landmarker_full.task'):
        self.pose_extractor = PoseExtractor(model_path)
    
    def analyze_video(self, video_path: str, rules_engine: Optional['RulesEngine'] = None) -> SquatAnalysisResult:
        """
        Run complete squat analysis on a video.
        
        Args:
            video_path: Path to video file
            rules_engine: Optional RulesEngine for therapist ROM limits
            
        Returns:
            SquatAnalysisResult with per-rep assessments
        """
        warnings = []
        frames = []
        
        # 1. Pose extraction on every frame
        for frame_idx, result in self.pose_extractor.process_video(video_path):
            norm, world = extract_landmarks(result)
            
            if norm is None or world is None:
                warnings.append(f"Frame {frame_idx}: No pose detected")
                continue
            
            # Check visibility of required landmarks
            vis_ok = all(norm[LANDMARKS[lm], 3] >= self.VISIBILITY_THRESHOLD for lm in self.REQUIRED_LANDMARKS)
            if not vis_ok:
                warnings.append(f"Frame {frame_idx}: Low landmark visibility")
                continue
            
            # 2. Angle computation (use world landmarks for accuracy)
            left_knee = calculate_knee_angle(world, 'left')
            right_knee = calculate_knee_angle(world, 'right')
            left_hip = calculate_hip_angle(world, 'left')
            right_hip = calculate_hip_angle(world, 'right')
            trunk_lean = calculate_trunk_lean(world)
            
            # Get timestamp from MediaPipe result
            timestamp = result.timestamp_ms / 1000.0
            
            frames.append(FrameData(
                frame_idx=frame_idx,
                timestamp=timestamp,
                left_knee=left_knee,
                right_knee=right_knee,
                left_hip=left_hip,
                right_hip=right_hip,
                trunk_lean=trunk_lean,
                left_knee_vis=norm[LANDMARKS['left_knee'], 3],
                right_knee_vis=norm[LANDMARKS['right_knee'], 3],
                left_hip_vis=norm[LANDMARKS['left_hip'], 3],
                right_hip_vis=norm[LANDMARKS['right_hip'], 3],
            ))
        
        if not frames:
            return SquatAnalysisResult(
                total_frames=0,
                fps=30.0,
                frames=[],
                reps=[],
                warnings=["No valid frames with pose detected"],
            )
        
        # 3. Rep detection from knee angle signal
        # Use average of left/right knee angles
        knee_angles = np.array([(f.left_knee + f.right_knee) / 2 for f in frames])
        timestamps = np.array([f.timestamp for f in frames])
        
        rep_indices = detect_reps(knee_angles, np.array([f.timestamp for f in frames]))
        
        if not rep_indices:
            warnings.append("No reps detected")
            return SquatAnalysisResult(
                total_frames=len(frames),
                fps=1.0 / (frames[1].timestamp - frames[0].timestamp) if len(frames) > 1 else 30.0,
                frames=frames,
                reps=[],
                warnings=warnings,
            )
        
        # 4. Feature extraction per rep
        fps = 1.0 / (frames[1].timestamp - frames[0].timestamp) if len(frames) > 1 else 30.0
        
        reps = []
        for rep_idx, (start, bottom, end) in enumerate(rep_indices):
            features = extract_squat_features(
                knee_angles_left=np.array([f.left_knee for f in frames]),
                knee_angles_right=np.array([f.right_knee for f in frames]),
                hip_angles_left=np.array([f.left_hip for f in frames]),
                hip_angles_right=np.array([f.right_hip for f in frames]),
                trunk_lean=np.array([f.trunk_lean for f in frames]),
                timestamps=np.array([f.timestamp for f in frames]),
                rep_start=start,
                rep_bottom=bottom,
                rep_end=end,
                fps=fps,
            )
            
            # 5. Build measurements for rules engine
            measurements = [
                Measurement(
                    metric=Metric.KNEE_ANGLE,
                    side=Side.LEFT,
                    phase=Phase.AT_BOTTOM,
                    value=features.min_left_knee_angle,
                    unit='deg',
                ),
                Measurement(
                    metric=Metric.KNEE_ANGLE,
                    side=Side.RIGHT,
                    phase=Phase.AT_BOTTOM,
                    value=features.min_right_knee_angle,
                    unit='deg',
                ),
                Measurement(
                    metric=Metric.KNEE_ANGLE,
                    side=Side.EITHER,
                    phase=Phase.AT_BOTTOM,
                    value=features.knee_asymmetry,
                    unit='deg',
                ),
                Measurement(
                    metric=Metric.HIP_ANGLE,
                    side=Side.EITHER,
                    phase=Phase.AT_BOTTOM,
                    value=features.min_hip_angle,
                    unit='deg',
                ),
                Measurement(
                    metric=Metric.TRUNK_LEAN,
                    side=Side.EITHER,
                    phase=Phase.AT_BOTTOM,
                    value=features.trunk_lean_at_bottom,
                    unit='deg',
                ),
                Measurement(
                    metric=Metric.TRUNK_LEAN,
                    side=Side.EITHER,
                    phase=Phase.AT_PEAK,
                    value=features.max_trunk_lean,
                    unit='deg',
                ),
            ]
            
            # 6. Rules evaluation
            ml_output = None  # TODO: ML model inference
            if rules_engine:
                assessment = rules_engine.evaluate(measurements, ml_output)
            else:
                assessment = RepAssessment(
                    rep_index=rep_idx,
                    status=Verdict.PASS,
                    measurements=measurements,
                    ml_output=ml_output,
                )
            
            assessment.rep_index = rep_idx
            reps.append(assessment)
        
        return SquatAnalysisResult(
            total_frames=len(frames),
            fps=fps,
            frames=frames,
            reps=reps,
            warnings=warnings,
        )