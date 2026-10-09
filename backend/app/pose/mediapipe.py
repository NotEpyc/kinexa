"""MediaPipe Pose extraction utilities."""

import cv2
import mediapipe as mp
import numpy as np
from typing import Generator, Tuple, Optional

# MediaPipe Tasks API
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# Landmark indices (MediaPipe Pose 33 landmarks)
LANDMARKS = {
    'nose': 0,
    'left_eye_inner': 1, 'left_eye': 2, 'left_eye_outer': 3,
    'right_eye_inner': 4, 'right_eye': 5, 'right_eye_outer': 6,
    'left_ear': 7, 'right_ear': 8,
    'mouth_left': 9, 'mouth_right': 10,
    'left_shoulder': 11, 'right_shoulder': 12,
    'left_elbow': 13, 'right_elbow': 14,
    'left_wrist': 15, 'right_wrist': 16,
    'left_pinky': 17, 'right_pinky': 18,
    'left_index': 19, 'right_index': 20,
    'left_thumb': 21, 'right_thumb': 22,
    'left_hip': 23, 'right_hip': 24,
    'left_knee': 25, 'right_knee': 26,
    'left_ankle': 27, 'right_ankle': 28,
    'left_heel': 29, 'right_heel': 30,
    'left_foot_index': 31, 'right_foot_index': 32,
}

# Angle convention: 180° = straight leg (full extension), 0° = fully flexed
# Use same-side joints: left_hip, left_knee, left_ankle OR right_hip, right_knee, right_ankle


class PoseExtractor:
    """Wrapper for MediaPipe Tasks PoseLandmarker."""

    def __init__(self, model_path: str = 'pose_landmarker_full.task', num_poses: int = 1):
        """
        Initialize PoseLandmarker.
        
        Args:
            model_path: Path to .task model bundle (download from MediaPipe)
            num_poses: Maximum number of poses to detect
        """
        base_options = mp_python.BaseOptions(model_asset_path=model_path)
        options = mp_vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=mp_vision.RunningMode.VIDEO,
            num_poses=num_poses,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            output_segmentation_masks=False,
        )
        self.landmarker = mp_vision.PoseLandmarker.create_from_options(options)

    def process_frame(self, frame: np.ndarray, timestamp_ms: int) -> mp_vision.PoseLandmarkerResult:
        """Process a single frame."""
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
        return self.landmarker.detect_for_video(mp_image, timestamp_ms)

    def process_video(self, video_path: str) -> Generator[Tuple[int, mp_vision.PoseLandmarkerResult], None, None]:
        """
        Process video frame by frame.
        
        Yields:
            (frame_index, PoseLandmarkerResult)
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0:
            fps = 30.0

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Convert BGR to RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            timestamp_ms = int(frame_idx * 1000 / fps)

            result = self.process_frame(frame_rgb, timestamp_ms)
            yield frame_idx, result

            frame_idx += 1

        cap.release()


def extract_landmarks(result: mp_vision.PoseLandmarkerResult) -> Tuple[Optional[np.ndarray], Optional[np.ndarray]]:
    """
    Extract normalized and world landmarks from result.
    
    Returns:
        (normalized_landmarks, world_landmarks) each shape (33, 3) or (None, None) if no pose
    """
    if not result.pose_landmarks or not result.pose_world_landmarks:
        return None, None

    # Normalized landmarks (x, y, z, visibility) - z is relative to hip depth
    norm = np.array([(lm.x, lm.y, lm.z, lm.visibility) for lm in result.pose_landmarks[0]])
    
    # World landmarks (x, y, z) in meters, hip-centered
    world = np.array([(lm.x, lm.y, lm.z) for lm in result.pose_world_landmarks[0]])

    return norm, world


def calculate_angle(p1: np.ndarray, p2: np.ndarray, p3: np.ndarray) -> float:
    """
    Calculate angle between three points (p1-p2-p3) in degrees.
    
    Angle convention: 180° = straight (p1-p2-p3 collinear), 0° = fully flexed.
    Uses vectors p2->p1 and p2->p3.
    
    Args:
        p1, p2, p3: Points as (x, y) or (x, y, z) arrays
        
    Returns:
        Angle in degrees (0-180)
    """
    v1 = p1 - p2
    v2 = p3 - p2
    
    # Use only x, y for 2D angle (or x, z for sagittal plane)
    v1_2d = v1[:2]
    v2_2d = v2[:2]
    
    cos_angle = np.dot(v1_2d, v2_2d) / (np.linalg.norm(v1_2d) * np.linalg.norm(v2_2d))
    cos_angle = np.clip(cos_angle, -1.0, 1.0)
    angle = np.degrees(np.arccos(cos_angle))
    
    return float(angle)


def calculate_knee_angle(world_landmarks: np.ndarray, side: str = 'left') -> float:
    """
    Calculate knee angle from world landmarks.
    
    Args:
        world_landmarks: (33, 3) array from extract_landmarks
        side: 'left' or 'right'
        
    Returns:
        Knee angle in degrees (180° = straight leg)
    """
    if side == 'left':
        hip, knee, ankle = LANDMARKS['left_hip'], LANDMARKS['left_knee'], LANDMARKS['left_ankle']
    else:
        hip, knee, ankle = LANDMARKS['right_hip'], LANDMARKS['right_knee'], LANDMARKS['right_ankle']
    
    return calculate_angle(world_landmarks[hip], world_landmarks[knee], world_landmarks[ankle])


def calculate_hip_angle(world_landmarks: np.ndarray, side: str = 'left') -> float:
    """Calculate hip angle (shoulder-hip-knee)."""
    if side == 'left':
        shoulder, hip, knee = LANDMARKS['left_shoulder'], LANDMARKS['left_hip'], LANDMARKS['left_knee']
    else:
        shoulder, hip, knee = LANDMARKS['right_shoulder'], LANDMARKS['right_hip'], LANDMARKS['right_knee']
    
    return calculate_angle(world_landmarks[shoulder], world_landmarks[hip], world_landmarks[knee])


def calculate_trunk_lean(world_landmarks: np.ndarray) -> float:
    """Calculate trunk lean (shoulder-hip line vs vertical)."""
    # Mid-shoulder and mid-hip
    mid_shoulder = (world_landmarks[LANDMARKS['left_shoulder']] + world_landmarks[LANDMARKS['right_shoulder']]) / 2
    mid_hip = (world_landmarks[LANDMARKS['left_hip']] + world_landmarks[LANDMARKS['right_hip']]) / 2
    
    # Vector from mid-hip to mid-shoulder
    trunk_vec = mid_shoulder - mid_hip
    vertical = np.array([0.0, 1.0, 0.0])  # Y-up
    
    # Project to sagittal plane (X-Z)
    trunk_sagittal = np.array([trunk_vec[0], trunk_vec[2]])
    vertical_sagittal = np.array([0.0, 1.0])
    
    cos_angle = np.dot(trunk_sagittal, vertical_sagittal) / (np.linalg.norm(trunk_sagittal) * np.linalg.norm(vertical_sagittal))
    cos_angle = np.clip(cos_angle, -1.0, 1.0)
    return float(np.degrees(np.arccos(cos_angle)))