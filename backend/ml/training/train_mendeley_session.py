"""Train an experimental video-level squat-quality RF with subject-grouped CV.

This artifact predicts the label of a whole video execution and must not be
loaded by the per-repetition quality endpoint.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import GroupKFold

from ml.datasets.prepare_mendeley_squat_sessions import FEATURE_NAMES


def _scores(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    return {
        "accuracy": float(accuracy_score(actual, predicted)),
        "precision_macro": float(precision_score(actual, predicted, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(actual, predicted, average="macro", zero_division=0)),
        "f1_macro": float(f1_score(actual, predicted, average="macro", zero_division=0)),
    }


def train(features_path: Path, output_dir: Path, folds: int = 5, seed: int = 42) -> tuple[Path, Path]:
    frame = pd.read_csv(features_path)
    required = set(FEATURE_NAMES) | {"label", "subject_id", "dataset", "label_granularity"}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"Feature table is missing columns: {', '.join(missing)}")
    if frame[list(required)].isna().any().any():
        raise ValueError("Features, labels, subject IDs, and dataset metadata must be non-missing.")
    if set(frame["label"].astype(str).str.lower()) != {"correct", "incorrect"}:
        raise ValueError("Training requires both source labels: correct and incorrect.")
    if set(frame["label_granularity"].astype(str)) != {"video_execution"}:
        raise ValueError("This trainer accepts only whole-video execution labels.")

    labels = frame["label"].astype(str).str.lower()
    label_names = ["correct", "incorrect"]
    y = labels.map({name: index for index, name in enumerate(label_names)}).to_numpy(dtype=np.int64)
    x = frame.loc[:, FEATURE_NAMES].to_numpy(dtype=np.float64)
    groups = frame["subject_id"].astype(str).to_numpy()
    group_count = len(np.unique(groups))
    if group_count < 3:
        raise ValueError("At least three distinct subjects are required for grouped validation.")
    n_splits = min(folds, group_count)
    if any(frame.loc[labels == label, "subject_id"].nunique() < n_splits for label in label_names):
        raise ValueError("Each class must occur in every subject-grouped validation fold.")

    model_template = RandomForestClassifier(
        n_estimators=400,
        max_depth=3,
        min_samples_leaf=2,
        class_weight="balanced",
        random_state=seed,
        n_jobs=-1,
    )
    oof = np.full(len(frame), -1, dtype=np.int64)
    fold_scores = []
    for train_idx, valid_idx in GroupKFold(n_splits=n_splits).split(x, y, groups):
        model = RandomForestClassifier(**model_template.get_params())
        model.fit(x[train_idx], y[train_idx])
        oof[valid_idx] = model.predict(x[valid_idx])
        fold_scores.append(_scores(y[valid_idx], oof[valid_idx]))
    if (oof < 0).any():
        raise RuntimeError("Grouped cross-validation failed to predict every video.")

    metrics = _scores(y, oof)
    rng = np.random.default_rng(seed)
    unique_groups = np.unique(groups)
    group_to_indices = {group: np.flatnonzero(groups == group) for group in unique_groups}
    bootstrap_f1 = []
    for _ in range(2000):
        sampled_groups = rng.choice(unique_groups, size=len(unique_groups), replace=True)
        indices = np.concatenate([group_to_indices[group] for group in sampled_groups])
        bootstrap_f1.append(f1_score(y[indices], oof[indices], average="macro", zero_division=0))
    ci_low, ci_high = np.percentile(bootstrap_f1, [2.5, 97.5])
    metrics["f1_macro_ci95_low"] = float(ci_low)
    metrics["f1_macro_ci95_high"] = float(ci_high)

    final_model = RandomForestClassifier(**model_template.get_params())
    final_model.fit(x, y)
    output_dir.mkdir(parents=True, exist_ok=True)
    version = "mendeley_squat_session_rf_v1"
    model_path = output_dir / f"{version}.joblib"
    metadata_path = output_dir / f"{version}.json"
    joblib.dump(final_model, model_path)
    metadata = {
        "version": version,
        "exercise": "squat",
        "model_type": "rf",
        "task": "video_session_classification",
        "feature_names": list(FEATURE_NAMES),
        "class_labels": label_names,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "source_datasets": sorted(frame["dataset"].astype(str).unique().tolist()),
        "source_record": "https://data.mendeley.com/datasets/kgbb3yn47p/3",
        "source_license": "CC BY 4.0; attribute the dataset creators when redistributing",
        "n_examples": int(len(frame)),
        "n_subjects": int(group_count),
        "group_column": "subject_id",
        "cv_folds": n_splits,
        "validation": "GroupKFold; all videos from a participant stay in one fold",
        "metrics": metrics,
        "fold_scores": fold_scores,
        "confusion_matrix": confusion_matrix(y, oof).tolist(),
        "global_feature_importance": dict(zip(FEATURE_NAMES, map(float, final_model.feature_importances_))),
        "label_granularity": "video_execution",
        "inference_compatibility": "session-level only; not compatible with per-rep model inference",
        "camera_validation": None,
        "notes": [
            "Experimental baseline from source good/bad video labels.",
            "Only squat side-view videos were used; the archive also contains front and diagonal views.",
            "One feature row per labeled video; no video label was copied to individual repetitions.",
            "Small public cohort; subject-grouped scores are preliminary and do not establish clinical validity or therapist agreement.",
            "The features use MediaPipe image-space 2D angles in the side-view plane and differ from the current live per-rep world-landmark model schema.",
        ],
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps({"model": str(model_path), "metadata": str(metadata_path), "metrics": metrics, "confusion_matrix": metadata["confusion_matrix"]}, indent=2))
    return model_path, metadata_path


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "features",
        nargs="?",
        type=Path,
        default=project_root / "data" / "features" / "mendeley_squat_side_sessions.csv",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=project_root / "models" / "experiments" / "mendeley-squat-session",
    )
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if not args.features.is_file():
        raise SystemExit(f"Feature table not found: {args.features}. Run prepare_mendeley_squat_sessions first.")
    return args


if __name__ == "__main__":
    args = parse_args()
    train(args.features, args.output_dir, args.folds, args.seed)
