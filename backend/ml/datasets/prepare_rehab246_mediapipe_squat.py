"""Extract live-pipeline MediaPipe features for annotated REHAB24-6 squat reps.

REHAB24-6 frame-indexed squat annotations are paired with Camera17/Camera18
RGB recordings. Each accepted row is a single annotated rep, with the source
subject label and camera preserved for subject-independent validation.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

from app.features.squat import extract_squat_features
from app.pose import (
    LANDMARKS,
    PoseExtractor,
    calculate_hip_angle,
    calculate_knee_angle,
    calculate_trunk_lean,
    extract_landmarks,
)


REQUIRED_LANDMARKS = (
    "left_hip", "right_hip", "left_knee", "right_knee",
    "left_ankle", "right_ankle", "left_shoulder", "right_shoulder",
)
VISIBILITY_THRESHOLD = 0.5
MIN_REP_VISIBILITY = 0.8
FPS_FALLBACK = 30.0


def _extract_recording(video_path: Path, pose_model_path: Path) -> tuple[dict[int, dict[str, float]], float, int]:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS)) or FPS_FALLBACK
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    capture.release()

    extractor = PoseExtractor(str(pose_model_path))
    frames: dict[int, dict[str, float]] = {}
    try:
        for frame_idx, result, timestamp in extractor.process_video(str(video_path)):
            normalized, world = extract_landmarks(result)
            if normalized is None or world is None:
                continue
            visible = all(
                normalized[LANDMARKS[name], 3] >= VISIBILITY_THRESHOLD
                for name in REQUIRED_LANDMARKS
            )
            if not visible:
                continue
            try:
                values = {
                    "left_knee": calculate_knee_angle(world, "left"),
                    "right_knee": calculate_knee_angle(world, "right"),
                    "left_hip": calculate_hip_angle(world, "left"),
                    "right_hip": calculate_hip_angle(world, "right"),
                    "trunk_lean": calculate_trunk_lean(world),
                }
            except (FloatingPointError, ZeroDivisionError):
                continue
            if all(np.isfinite(value) for value in values.values()):
                frames[frame_idx] = {**values, "timestamp": timestamp}
    finally:
        extractor.landmarker.close()
    return frames, fps, frame_count


def _features_for_segment(
    frames: dict[int, dict[str, float]],
    start: int,
    end: int,
    fps: float,
) -> tuple[dict[str, float] | None, float]:
    indices = np.arange(start, end + 1)
    valid = [int(index) for index in indices if int(index) in frames]
    coverage = len(valid) / max(len(indices), 1)
    if coverage < MIN_REP_VISIBILITY or len(valid) < 5:
        return None, coverage

    signal = {key: np.asarray([frames[index][key] for index in valid], dtype=np.float64)
              for key in ("left_knee", "right_knee", "left_hip", "right_hip", "trunk_lean")}
    timestamps = np.asarray([frames[index]["timestamp"] for index in valid], dtype=np.float64)
    bottom = int(np.argmin((signal["left_knee"] + signal["right_knee"]) / 2.0))
    features = extract_squat_features(
        knee_angles_left=signal["left_knee"],
        knee_angles_right=signal["right_knee"],
        hip_angles_left=signal["left_hip"],
        hip_angles_right=signal["right_hip"],
        trunk_lean=signal["trunk_lean"],
        timestamps=timestamps,
        rep_start=0,
        rep_bottom=bottom,
        rep_end=len(valid) - 1,
        fps=fps,
    )
    return features.as_model_dict(), coverage


def prepare(
    video_dir: Path,
    metadata_dir: Path,
    pose_model_path: Path,
    output_path: Path,
    camera_views: tuple[str, ...] = ("Camera17", "Camera18"),
    exercise_id: int = 6,
) -> pd.DataFrame:
    if not pose_model_path.is_file():
        raise FileNotFoundError(f"MediaPipe pose model not found: {pose_model_path}")
    segments = pd.read_csv(metadata_dir / "Segmentation.csv", sep=";")
    segments = segments.loc[
        (segments["exercise_id"] == exercise_id)
        & (segments["mocap_erroneous"] == 0)
    ].copy()
    if segments.empty:
        raise ValueError(f"No valid segments found for exercise_id={exercise_id}.")

    recordings: dict[tuple[str, str], tuple[dict[int, dict[str, float]], float, int]] = {}
    feature_rows: list[dict[str, object]] = []
    skipped: defaultdict[str, int] = defaultdict(int)
    for camera in camera_views:
        for video_id, group in segments.groupby("video_id", sort=True):
            suffix = f"{video_id}-{camera}-30fps.mp4"
            if camera == "Camera18":
                suffix = f"{video_id}-{camera}-30fps-transposed.mp4"
            candidates = list((video_dir / f"Ex{exercise_id}").glob(suffix))
            if len(candidates) != 1:
                skipped["missing_or_ambiguous_video"] += len(group)
                print(f"Skip {video_id}/{camera}: expected one video matching {suffix}", flush=True)
                continue

            cache_key = (str(video_id), camera)
            if cache_key not in recordings:
                recording = _extract_recording(candidates[0], pose_model_path)
                recordings[cache_key] = recording
                print(
                    f"Processed {video_id}/{camera}: {len(recording[0])}/{recording[2]} usable frames",
                    flush=True,
                )
            frame_map, fps, total_frames = recordings[cache_key]
            for row in group.itertuples(index=False):
                start, end = int(row.first_frame), int(row.last_frame)
                if end >= total_frames:
                    skipped["annotation_outside_video"] += 1
                    continue
                values, coverage = _features_for_segment(frame_map, start, end, fps)
                if values is None:
                    skipped["insufficient_pose_coverage"] += 1
                    continue
                feature_rows.append({
                    **values,
                    "label": "correct" if int(row.correctness) == 1 else "incorrect",
                    "subject_id": str(row.person_id),
                    "video_id": str(video_id),
                    "repetition": int(row.repetition_number),
                    "view": str(row.cam17_orientation),
                    "camera": camera,
                    "pose_coverage": coverage,
                    "dataset": "REHAB24-6-MediaPipe",
                })

    frame = pd.DataFrame(feature_rows)
    if frame.empty:
        raise ValueError(f"No valid MediaPipe squat reps were extracted. Skipped: {dict(skipped)}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output_path, index=False)
    print({
        "output": str(output_path),
        "rows": len(frame),
        "subjects": frame["subject_id"].nunique(),
        "labels": frame["label"].value_counts().to_dict(),
        "cameras": frame["camera"].value_counts().to_dict(),
        "skipped": dict(skipped),
    })
    return frame


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[3]
    dataset_dir = project_root / "data" / "raw" / "rehab24-6"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video-dir", type=Path, default=dataset_dir / "videos")
    parser.add_argument("--metadata-dir", type=Path, default=dataset_dir)
    parser.add_argument("--pose-model", type=Path, default=project_root / "backend" / "models" / "pose_landmarker_full.task")
    parser.add_argument("--output", type=Path, default=project_root / "data" / "features" / "rehab246_squat_mediapipe.csv")
    parser.add_argument("--cameras", nargs="+", choices=("Camera17", "Camera18"), default=("Camera17", "Camera18"))
    parser.add_argument("--exercise-id", type=int, default=6)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    prepare(args.video_dir, args.metadata_dir, args.pose_model, args.output, tuple(args.cameras), args.exercise_id)
