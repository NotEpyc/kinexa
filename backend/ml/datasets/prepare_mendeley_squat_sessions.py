"""Extract one MediaPipe feature row per labelled squat video and camera view.

Mendeley labels each entire execution as good/bad. This adapter preserves that
granularity: it does not copy video labels onto individual repetitions. It uses
MediaPipe world landmarks and 3D angles across side, front, and diagonal views,
selecting the more visible leg for each video.
The resulting session model is experimental and is not compatible with Kinexa's
per-repetition quality inference endpoint.
"""

from __future__ import annotations

import argparse
import math
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

from app.pose import LANDMARKS, PoseExtractor, extract_landmarks


LABEL_PATTERN = re.compile(
    r"(?:^|/)subject_(?P<subject>\d+)/squat/(?P<label>good|bad)/(?P<view>side|front|diagonal)/(?P<filename>[^/]+\.mp4)$",
    re.IGNORECASE,
)
FEATURE_NAMES = (
    "knee_min_angle_deg",
    "knee_p10_angle_deg",
    "knee_median_angle_deg",
    "knee_rom_deg",
    "hip_min_angle_deg",
    "trunk_max_lean_deg",
    "trunk_p95_lean_deg",
    "trunk_median_lean_deg",
)
VISIBILITY_THRESHOLD = 0.5


def _summarize_video(video_path: Path, pose_model_path: Path) -> dict[str, float] | None:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    capture.release()
    if fps <= 0 or width <= 0 or height <= 0:
        raise ValueError(f"Invalid video metadata for {video_path}.")

    pose = PoseExtractor(str(pose_model_path))
    samples: list[tuple[np.ndarray, np.ndarray]] = []
    try:
        for _, result, _ in pose.process_video(str(video_path)):
            norm, world = extract_landmarks(result)
            if norm is not None and world is not None:
                samples.append((world.copy(), norm[:, 3].copy()))
    finally:
        pose.landmarker.close()

    if not samples:
        return None

    # Select the more visible leg for the whole clip. World-space 3D angles
    # allow the same feature definition to be used across camera views.
    side_scores: dict[str, list[float]] = {"left": [], "right": []}
    for _, visibility in samples:
        for side in ("left", "right"):
            indices = [LANDMARKS[f"{side}_{joint}"] for joint in ("hip", "knee", "ankle")]
            side_scores[side].append(float(np.min(visibility[indices])))
    chosen_side = max(side_scores, key=lambda side: float(np.median(side_scores[side])))
    hip_idx = LANDMARKS[f"{chosen_side}_hip"]
    knee_idx = LANDMARKS[f"{chosen_side}_knee"]
    ankle_idx = LANDMARKS[f"{chosen_side}_ankle"]
    shoulder_idx = LANDMARKS[f"{chosen_side}_shoulder"]

    knee_angles: list[float] = []
    hip_angles: list[float] = []
    trunk_angles: list[float] = []
    shoulder_left, shoulder_right = LANDMARKS["left_shoulder"], LANDMARKS["right_shoulder"]
    hip_left, hip_right = LANDMARKS["left_hip"], LANDMARKS["right_hip"]
    for coordinates, visibility in samples:
        if min(visibility[hip_idx], visibility[knee_idx], visibility[ankle_idx]) < VISIBILITY_THRESHOLD:
            continue
        knee_angle = _angle_3d(coordinates[hip_idx], coordinates[knee_idx], coordinates[ankle_idx])
        if np.isfinite(knee_angle):
            knee_angles.append(knee_angle)

        if min(visibility[shoulder_idx], visibility[hip_idx], visibility[knee_idx]) >= VISIBILITY_THRESHOLD:
            hip_angle = _angle_3d(coordinates[shoulder_idx], coordinates[hip_idx], coordinates[knee_idx])
            if np.isfinite(hip_angle):
                hip_angles.append(hip_angle)

        if min(visibility[shoulder_left], visibility[shoulder_right], visibility[hip_left], visibility[hip_right]) >= VISIBILITY_THRESHOLD:
            shoulder_mid = (coordinates[shoulder_left] + coordinates[shoulder_right]) / 2.0
            hip_mid = (coordinates[hip_left] + coordinates[hip_right]) / 2.0
            trunk = shoulder_mid - hip_mid
            lean = math.degrees(math.acos(float(np.clip(abs(trunk[1]) / max(np.linalg.norm(trunk), 1e-8), -1.0, 1.0))))
            if np.isfinite(lean):
                trunk_angles.append(lean)

    if len(knee_angles) < max(10, int(frame_count * 0.05)) or len(hip_angles) < 10 or len(trunk_angles) < 10:
        return None

    knee = np.asarray(knee_angles, dtype=np.float64)
    hip = np.asarray(hip_angles, dtype=np.float64)
    trunk = np.asarray(trunk_angles, dtype=np.float64)
    return {
        "knee_min_angle_deg": float(np.min(knee)),
        "knee_p10_angle_deg": float(np.percentile(knee, 10)),
        "knee_median_angle_deg": float(np.median(knee)),
        "knee_rom_deg": float(np.percentile(knee, 95) - np.percentile(knee, 5)),
        "hip_min_angle_deg": float(np.min(hip)),
        "trunk_max_lean_deg": float(np.max(trunk)),
        "trunk_p95_lean_deg": float(np.percentile(trunk, 95)),
        "trunk_median_lean_deg": float(np.median(trunk)),
        "pose_coverage": float(len(samples) / max(frame_count, 1)),
        "selected_side": chosen_side,
        "valid_knee_frames": len(knee_angles),
        "duration_s": float(frame_count / fps),
    }


def _angle_3d(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Return the 0..180 Euclidean 3D angle at b."""
    ba = a - b
    bc = c - b
    denominator = float(np.linalg.norm(ba) * np.linalg.norm(bc))
    if denominator < 1e-8:
        return float("nan")
    cosine = float(np.clip(np.dot(ba, bc) / denominator, -1.0, 1.0))
    return float(np.degrees(np.arccos(cosine)))


def prepare(
    archive_path: Path,
    pose_model_path: Path,
    output_path: Path,
    max_videos: int | None = None,
) -> dict[str, int]:
    if not archive_path.is_file():
        raise FileNotFoundError(f"Dataset archive not found: {archive_path}")
    if not pose_model_path.is_file():
        raise FileNotFoundError(f"MediaPipe pose model not found: {pose_model_path}")

    rows: list[dict[str, object]] = []
    skipped = 0
    with zipfile.ZipFile(archive_path) as archive:
        members: list[tuple[str, dict[str, str]]] = []
        for info in archive.infolist():
            if info.is_dir():
                continue
            match = LABEL_PATTERN.search(info.filename.replace("\\", "/"))
            if match:
                members.append((info.filename, match.groupdict()))
        members.sort(key=lambda item: item[0].casefold())
        if max_videos is not None:
            if max_videos < 1:
                raise ValueError("--max-videos must be greater than zero.")
            members = members[:max_videos]
        if not members:
            raise ValueError("No subject-labelled squat MP4 files were found in the archive.")

        temp_root = output_path.parents[1] / "processed" / ".mendeley-tmp"
        temp_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="kinexa-mendeley-", dir=temp_root) as temp_dir:
            video_path = Path(temp_dir) / "current.mp4"
            for index, (member, labels) in enumerate(members, start=1):
                with archive.open(member) as source, video_path.open("wb") as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)
                features = _summarize_video(video_path, pose_model_path)
                if features is None:
                    skipped += 1
                    print(f"[{index}/{len(members)}] skipped (insufficient visible pose): {Path(member).name}", flush=True)
                else:
                    label = "correct" if labels["label"].casefold() == "good" else "incorrect"
                    rows.append({
                        **features,
                        "label": label,
                        "subject_id": f"subject_{int(labels['subject']):03d}",
                        "video_id": Path(member).stem,
                        "view": labels["view"].casefold(),
                        "dataset": "Mendeley_Seven_Exercises_v3",
                        "label_granularity": "video_execution",
                        "label_assignment": "source_video_label",
                    })
                    print(
                        f"[{index}/{len(members)}] {Path(member).name}: "
                        f"{features['valid_knee_frames']} knee frames, side={features['selected_side']}, label={label}",
                        flush=True,
                    )
                video_path.unlink(missing_ok=True)

    if not rows:
        raise ValueError("No videos had enough visible pose data; no feature table was written.")
    frame = pd.DataFrame(rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output_path, index=False)
    stats = {
        "source_videos": len(members),
        "usable_videos": len(frame),
        "skipped_videos": skipped,
        "subjects": int(frame["subject_id"].nunique()),
        "correct_videos": int((frame["label"] == "correct").sum()),
        "incorrect_videos": int((frame["label"] == "incorrect").sum()),
    }
    print(f"Wrote session-level features to {output_path}: {stats}")
    return stats


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--archive",
        type=Path,
        default=project_root / "data" / "raw" / "mendeley-seven-exercises" / "dataset-subject-wise.zip",
    )
    parser.add_argument(
        "--pose-model",
        type=Path,
        default=project_root / "backend" / "models" / "pose_landmarker_full.task",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=project_root / "data" / "features" / "mendeley_squat_sessions_3d.csv",
    )
    parser.add_argument("--max-videos", type=int, help="Optional pilot limit; omit to process all squat view videos.")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    prepare(args.archive, args.pose_model, args.output, args.max_videos)
