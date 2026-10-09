"""Squat feature extraction per rep."""

from dataclasses import dataclass
from typing import List, Optional
import numpy as np


@dataclass
class SquatFeatures:
    """Per-rep squat features (matching PRD §6.5 table)."""
    # Depth
    min_left_knee_angle: float
    min_right_knee_angle: float
    
    # Asymmetry at bottom
    knee_asymmetry: float
    
    # Hip flexion
    min_hip_angle: float
    
    # Trunk lean
    max_trunk_lean: float
    trunk_lean_at_bottom: float
    
    # Tempo
    duration: float
    descent_time: float
    ascent_time: float
    
    # Smoothness
    smoothness: float
    
    # Rep timing
    start_frame: int
    bottom_frame: int
    end_frame: int
    start_time: float
    bottom_time: float
    end_time: float


def extract_squat_features(
    knee_angles_left: np.ndarray,
    knee_angles_right: np.ndarray,
    hip_angles_left: np.ndarray,
    hip_angles_right: np.ndarray,
    trunk_lean: np.ndarray,
    timestamps: np.ndarray,
    rep_start: int,
    rep_bottom: int,
    rep_end: int,
    fps: float,
) -> SquatFeatures:
    """
    Extract per-rep squat features from angle time series.
    
    Args:
        knee_angles_left: Left knee angle per frame (degrees)
        knee_angles_right: Right knee angle per frame (degrees)
        hip_angles_left: Left hip angle per frame (degrees)
        hip_angles_right: Right hip angle per frame (degrees)
        trunk_lean: Trunk lean per frame (degrees)
        timestamps: Frame timestamps (seconds)
        rep_start: Start frame index
        rep_bottom: Bottom frame index
        rep_end: End frame index
        fps: Video frame rate
        
    Returns:
        SquatFeatures dataclass with all per-rep features
    """
    # Slice to rep window
    start, bottom, end = rep_start, rep_bottom, rep_end
    
    # Depth: minimum knee angle (flexion)
    min_left_knee = float(np.min(knee_angles_left[start:end+1]))
    min_right_knee = float(np.min(knee_angles_right[start:end+1]))
    
    # Asymmetry at bottom
    knee_asymmetry = float(abs(knee_angles_left[bottom] - knee_angles_right[bottom]))
    
    # Hip flexion at bottom
    min_hip = float(min(
        np.min(hip_angles_left[start:end+1]),
        np.min(hip_angles_right[start:end+1])
    ))
    
    # Trunk lean
    max_trunk = float(np.max(trunk_lean[start:end+1]))
    trunk_at_bottom = float(trunk_lean[bottom])
    
    # Tempo
    duration = timestamps[end] - timestamps[start]
    descent_time = timestamps[bottom] - timestamps[start]
    ascent_time = timestamps[end] - timestamps[bottom]
    
    # Smoothness: jerk (derivative of angular velocity) variance
    # Using left knee angle as reference
    knee_vel = np.gradient(knee_angles_left[start:end+1], timestamps[start:end+1])
    knee_acc = np.gradient(knee_vel, timestamps[start:end+1])
    knee_jerk = np.gradient(knee_acc, timestamps[start:end+1])
    smoothness = float(np.std(knee_jerk))
    
    return SquatFeatures(
        min_left_knee_angle=min_left_knee,
        min_right_knee_angle=min_right_knee,
        knee_asymmetry=knee_asymmetry,
        min_hip_angle=min_hip,
        max_trunk_lean=max_trunk,
        trunk_lean_at_bottom=trunk_at_bottom,
        duration=duration,
        descent_time=descent_time,
        ascent_time=ascent_time,
        smoothness=smoothness,
        start_frame=0,  # Will be set by caller
        bottom_frame=0,
        end_frame=0,
        start_time=0.0,
        bottom_time=0.0,
        end_time=0.0,
    )


def detect_reps(knee_angles: np.ndarray, timestamps: np.ndarray, 
                min_depth_deg: float = 30.0, min_spacing_frames: int = 15) -> List[tuple]:
    """
    Detect reps from knee angle signal using valley detection.
    
    Args:
        knee_angles: Knee angle time series (degrees, 180=straight)
        timestamps: Frame timestamps (seconds)
        min_depth_deg: Minimum knee flexion depth to count as rep
        min_spacing_frames: Minimum frames between reps
        
    Returns:
        List of (start_idx, bottom_idx, end_idx) tuples
    """
    from scipy.signal import find_peaks
    
    # Invert: valleys in knee angle = peaks in inverted signal
    inverted = 180 - knee_angles
    
    # Find valleys (peaks in inverted)
    peaks, properties = find_peaks(
        inverted,
        height=min_depth_deg,  # Minimum flexion depth
        distance=min_spacing_frames,
        prominence=min_depth_deg / 2,
    )
    
    reps = []
    for peak_idx in peaks:
        # Find start (previous local max before descent)
        # and end (next local max after ascent)
        # Simplified: use fixed window around peak
        window = int(2.0 * 30)  # ~2 seconds at 30fps
        start = max(0, peak_idx - window)
        end = min(len(knee_angles) - 1, peak_idx + window)
        
        # Refine: find actual start/end where angle crosses 170° (near standing)
        # This is a simplified version
        reps.append((start, peak_idx, end))
    
    return reps