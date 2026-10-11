"""Build canonical squat feature rows from REHAB24-6 3D joint sequences.

The source archive and segmentation table must be downloaded from Zenodo and kept
outside Git. This adapter uses the dataset's motion-capture joints (not RGB or
MediaPipe output), so validation measures exercise classification on source
skeleton data and does not establish camera-to-model generalization.
"""

from __future__ import annotations

import argparse
import io
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from app.features.squat import extract_squat_features


JOINT_MAP = {
    "shoulder_left": "LeftArm",
    "shoulder_right": "RightArm",
    "hip": "Hips",
    "knee_left": "LeftLeg",
    "knee_right": "RightLeg",
    "ankle_left": "LeftFoot",
    "ankle_right": "RightFoot",
}
FPS = 30.0


def _read_joint_names(path: Path) -> dict[str, int]:
    names: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        index, name = line.split(":", 1)
        names[name.strip()] = int(index.strip())
    return names


def _normalise(vector: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(vector))
    if length < 1e-8:
        raise ValueError("Cannot derive body coordinate axes from degenerate skeleton joints.")
    return vector / length


def _vertical_axis(sequence: np.ndarray, joints: dict[str, int]) -> np.ndarray:
    """Estimate gravity direction from the head-to-hip vector over a recording."""
    hips = sequence[:, joints["Hips"], :3]
    head = sequence[:, joints["Head"], :3]
    return _normalise(np.median(head - hips, axis=0))


def _sagittal_basis(sequence: np.ndarray, joints: dict[str, int], vertical: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Estimate this rep's sagittal plane so camera-facing changes are supported."""
    left_leg = sequence[:, joints["LeftLeg"], :3]
    right_leg = sequence[:, joints["RightLeg"], :3]
    lateral_raw = np.median(right_leg - left_leg, axis=0)
    lateral_raw = lateral_raw - np.dot(lateral_raw, vertical) * vertical
    lateral = _normalise(lateral_raw)
    forward = _normalise(np.cross(lateral, vertical))
    return vertical, forward


def _project(vector: np.ndarray, vertical: np.ndarray, forward: np.ndarray) -> np.ndarray:
    return np.asarray([np.dot(vector, forward), np.dot(vector, vertical)], dtype=np.float64)


def _joint_angle(a: np.ndarray, b: np.ndarray, c: np.ndarray, vertical: np.ndarray, forward: np.ndarray) -> float:
    ba = _project(a - b, vertical, forward)
    bc = _project(c - b, vertical, forward)
    denominator = float(np.linalg.norm(ba) * np.linalg.norm(bc))
    if denominator < 1e-8:
        return float("nan")
    cosine = float(np.clip(np.dot(ba, bc) / denominator, -1.0, 1.0))
    return float(np.degrees(np.arccos(cosine)))


def _trunk_lean(shoulder_mid: np.ndarray, hip_mid: np.ndarray, vertical: np.ndarray, forward: np.ndarray) -> float:
    trunk = shoulder_mid - hip_mid
    return float(np.degrees(np.arctan2(abs(np.dot(trunk, forward)), abs(np.dot(trunk, vertical)))))


def _features_for_rep(
    sequence: np.ndarray,
    joints: dict[str, int],
    vertical: np.ndarray,
) -> dict[str, float]:
    vertical, forward = _sagittal_basis(sequence, joints, vertical)
    coords = {
        name: sequence[:, joints[source_name], :3]
        for name, source_name in JOINT_MAP.items()
    }
    shoulder_mid = (coords["shoulder_left"] + coords["shoulder_right"]) / 2

    left_knee = np.asarray([
        _joint_angle(coords["hip"][i], coords["knee_left"][i], coords["ankle_left"][i], vertical, forward)
        for i in range(len(sequence))
    ])
    right_knee = np.asarray([
        _joint_angle(coords["hip"][i], coords["knee_right"][i], coords["ankle_right"][i], vertical, forward)
        for i in range(len(sequence))
    ])
    left_hip = np.asarray([
        _joint_angle(coords["shoulder_left"][i], coords["hip"][i], coords["knee_left"][i], vertical, forward)
        for i in range(len(sequence))
    ])
    right_hip = np.asarray([
        _joint_angle(coords["shoulder_right"][i], coords["hip"][i], coords["knee_right"][i], vertical, forward)
        for i in range(len(sequence))
    ])
    trunk = np.asarray([
        _trunk_lean(shoulder_mid[i], coords["hip"][i], vertical, forward)
        for i in range(len(sequence))
    ])
    arrays = (left_knee, right_knee, left_hip, right_hip, trunk)
    if not all(np.isfinite(array).all() for array in arrays):
        raise ValueError("Rep contains degenerate joint geometry.")

    timestamps = np.arange(len(sequence), dtype=np.float64) / FPS
    bottom = int(np.argmin((left_knee + right_knee) / 2))
    if len(sequence) < 5:
        raise ValueError("Rep is too short for stable smoothness features.")
    features = extract_squat_features(
        knee_angles_left=left_knee,
        knee_angles_right=right_knee,
        hip_angles_left=left_hip,
        hip_angles_right=right_hip,
        trunk_lean=trunk,
        timestamps=timestamps,
        rep_start=0,
        rep_bottom=bottom,
        rep_end=len(sequence) - 1,
        fps=FPS,
    )
    return features.as_model_dict()


def prepare(archive_path: Path, metadata_dir: Path, output_path: Path, exercise_id: int = 6) -> pd.DataFrame:
    segmentation = pd.read_csv(metadata_dir / "Segmentation.csv", sep=";")
    segmentation = segmentation.loc[
        (segmentation["exercise_id"] == exercise_id)
        & (segmentation["mocap_erroneous"] == 0)
    ].copy()
    if segmentation.empty:
        raise ValueError(f"No valid segments found for exercise_id={exercise_id}.")

    joint_names = _read_joint_names(metadata_dir / "joints_names.txt")
    missing_joints = sorted((set(JOINT_MAP.values()) | {"Head"}) - set(joint_names))
    if missing_joints:
        raise ValueError(f"Joint name file is missing required joints: {', '.join(missing_joints)}")

    feature_rows: list[dict[str, object]] = []
    sequence_cache: dict[str, np.ndarray] = {}
    vertical_cache: dict[str, np.ndarray] = {}
    with zipfile.ZipFile(archive_path) as archive:
        members = set(archive.namelist())
        for row in segmentation.itertuples(index=False):
            video_id = str(row.video_id)
            if video_id not in sequence_cache:
                suffix = f"Ex{exercise_id}/{video_id}-30fps.npy"
                matches = [member for member in members if member.endswith(suffix)]
                if len(matches) != 1:
                    raise ValueError(f"Expected one {suffix} in the 3D joints archive; found {len(matches)}.")
                sequence = np.load(io.BytesIO(archive.read(matches[0])), allow_pickle=False)
                if sequence.ndim != 3 or sequence.shape[2] < 3:
                    raise ValueError(f"Unexpected skeleton shape for {video_id}: {sequence.shape}.")
                sequence_cache[video_id] = sequence[:, :, :3]
                vertical_cache[video_id] = _vertical_axis(sequence_cache[video_id], joint_names)

            full_sequence = sequence_cache[video_id]
            start, end = int(row.first_frame), int(row.last_frame)
            rep = full_sequence[start : end + 1]
            if len(rep) < 5:
                continue
            try:
                values = _features_for_rep(rep, joint_names, vertical_cache[video_id])
            except ValueError as exc:
                print(f"Skipping {video_id} rep {row.repetition_number}: {exc}")
                continue
            feature_rows.append({
                **values,
                "label": "correct" if int(row.correctness) == 1 else "incorrect",
                "subject_id": str(row.person_id),
                "video_id": video_id,
                "repetition": int(row.repetition_number),
                "view": str(row.cam17_orientation),
                "dataset": "REHAB24-6",
            })

    frame = pd.DataFrame(feature_rows)
    if frame.empty:
        raise ValueError("No feature rows were created from the selected reps.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output_path, index=False)
    print(
        f"Wrote {len(frame)} squat reps across {frame['subject_id'].nunique()} subjects "
        f"({(frame['label'] == 'correct').sum()} correct, {(frame['label'] == 'incorrect').sum()} incorrect) "
        f"to {output_path}"
    )
    return frame


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[3]
    dataset_dir = project_root / "data" / "raw" / "rehab24-6"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=dataset_dir / "3d_joints.zip")
    parser.add_argument("--metadata-dir", type=Path, default=dataset_dir)
    parser.add_argument("--output", type=Path, default=project_root / "data" / "features" / "rehab246_squat.csv")
    parser.add_argument("--exercise-id", type=int, default=6)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    prepare(args.archive, args.metadata_dir, args.output, args.exercise_id)
