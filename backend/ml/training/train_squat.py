"""Train RF/XGBoost baselines from a subject-labelled per-rep feature CSV.

The script intentionally refuses rows without subject IDs. Random rep-level
splits leak subject-specific motion patterns and are not valid for this project.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    precision_score,
    recall_score,
)
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.utils.class_weight import compute_sample_weight
from app.features.registry import EXERCISE_FEATURE_SCHEMAS, get_feature_schema


def _make_estimator(model_type: str, task: str, random_state: int) -> Pipeline:
    if model_type == "rf" and task == "classification":
        estimator = RandomForestClassifier(
            n_estimators=400,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=random_state,
            n_jobs=-1,
        )
    elif model_type == "rf":
        estimator = RandomForestRegressor(
            n_estimators=400,
            min_samples_leaf=2,
            random_state=random_state,
            n_jobs=-1,
        )
    elif model_type == "xgb" and task == "classification":
        from xgboost import XGBClassifier

        estimator = XGBClassifier(
            n_estimators=250,
            max_depth=2,
            learning_rate=0.04,
            subsample=0.9,
            colsample_bytree=0.9,
            reg_lambda=2.0,
            eval_metric="logloss",
            random_state=random_state,
            n_jobs=1,
        )
    else:
        from xgboost import XGBRegressor

        estimator = XGBRegressor(
            n_estimators=250,
            max_depth=2,
            learning_rate=0.04,
            subsample=0.9,
            colsample_bytree=0.9,
            reg_lambda=2.0,
            objective="reg:squarederror",
            random_state=random_state,
            n_jobs=1,
        )

    return Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("model", estimator),
        ]
    )


def _regression_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    correlation = float(np.corrcoef(actual, predicted)[0, 1]) if len(actual) > 1 else float("nan")
    if not np.isfinite(correlation):
        correlation = 0.0
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "correlation": correlation,
    }


def _classification_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    return {
        "accuracy": float(accuracy_score(actual, predicted)),
        "precision_macro": float(precision_score(actual, predicted, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(actual, predicted, average="macro", zero_division=0)),
        "f1_macro": float(f1_score(actual, predicted, average="macro", zero_division=0)),
    }


def _group_bootstrap_ci(
    actual: np.ndarray,
    predicted: np.ndarray,
    groups: np.ndarray,
    metric_fn: Callable[[np.ndarray, np.ndarray], dict[str, float]],
    metric_name: str,
    seed: int,
    iterations: int = 1000,
) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    unique_groups = np.unique(groups)
    values: list[float] = []
    group_indices = {group: np.flatnonzero(groups == group) for group in unique_groups}

    for _ in range(iterations):
        sampled_groups = rng.choice(unique_groups, size=len(unique_groups), replace=True)
        indices = np.concatenate([group_indices[group] for group in sampled_groups])
        if len(np.unique(actual[indices])) < 2 and metric_name.startswith("f1"):
            continue
        value = metric_fn(actual[indices], predicted[indices])[metric_name]
        if np.isfinite(value):
            values.append(value)

    if not values:
        return 0.0, 0.0
    low, high = np.percentile(values, [2.5, 97.5])
    return float(low), float(high)


def train(args: argparse.Namespace) -> list[Path]:
    schema = get_feature_schema(args.exercise)
    feature_names = schema.feature_names
    frame = pd.read_csv(args.features)
    required = set(feature_names) | {args.target, args.group}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"Feature table is missing required columns: {', '.join(missing)}")
    if frame[[args.target, args.group]].isna().any().any():
        raise ValueError("Target and subject_id/group columns cannot contain missing values.")

    frame[args.group] = frame[args.group].astype(str)
    group_count = frame[args.group].nunique()
    if group_count < 3:
        raise ValueError("At least 3 distinct subject groups are required for grouped cross-validation.")
    n_splits = min(args.folds, group_count)

    for name in feature_names:
        frame[name] = pd.to_numeric(frame[name], errors="coerce")
        if frame[name].notna().sum() == 0:
            raise ValueError(f"Feature '{name}' has no numeric observations.")

    class_labels: list[str] = []
    if args.task == "classification":
        class_labels = sorted(frame[args.target].astype(str).unique().tolist())
        if len(class_labels) != 2:
            raise ValueError("Classification currently requires exactly two classes (for example correct/incorrect).")
        if {label.casefold() for label in class_labels} != {"correct", "incorrect"}:
            raise ValueError("Classification labels must be 'correct' and 'incorrect' so inference can apply the documented advisory semantics.")
        represented_subjects = {
            label: frame.loc[frame[args.target].astype(str) == label, args.group].nunique()
            for label in class_labels
        }
        if min(represented_subjects.values()) < n_splits:
            raise ValueError(
                f"Each class must occur in at least {n_splits} distinct subjects so every grouped training fold can learn both classes."
            )
        label_to_id = {label: index for index, label in enumerate(class_labels)}
        y = frame[args.target].astype(str).map(label_to_id).to_numpy(dtype=np.int64)
    else:
        y = pd.to_numeric(frame[args.target], errors="coerce").to_numpy(dtype=np.float64)
        if not np.isfinite(y).all():
            raise ValueError("Regression target must be numeric and non-missing.")

    x = frame.loc[:, feature_names].to_numpy(dtype=np.float64)
    groups = frame[args.group].to_numpy()
    splitter = GroupKFold(n_splits=n_splits)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    artifacts: list[Path] = []
    metric_fn = _classification_metrics if args.task == "classification" else _regression_metrics
    metric_names = ["accuracy", "precision_macro", "recall_macro", "f1_macro"] if args.task == "classification" else ["mae", "correlation"]
    baseline_oof = np.full(len(frame), np.nan, dtype=np.float64)

    for model_type in args.models:
        template = _make_estimator(model_type, args.task, args.seed)
        oof = np.full(len(frame), np.nan, dtype=np.float64)
        fold_scores = []
        for train_idx, valid_idx in splitter.split(x, y, groups):
            if args.task == "classification":
                labels, counts = np.unique(y[train_idx], return_counts=True)
                baseline_oof[valid_idx] = labels[int(np.argmax(counts))]
            else:
                baseline_oof[valid_idx] = float(np.mean(y[train_idx]))
            model = clone(template)
            fit_kwargs = {}
            if args.task == "classification" and model_type == "xgb":
                fit_kwargs["model__sample_weight"] = compute_sample_weight("balanced", y[train_idx])
            model.fit(x[train_idx], y[train_idx], **fit_kwargs)
            fold_prediction = model.predict(x[valid_idx])
            oof[valid_idx] = fold_prediction
            fold_scores.append(metric_fn(y[valid_idx], fold_prediction))

        if np.isnan(oof).any():
            raise RuntimeError("Grouped cross-validation did not produce an out-of-fold prediction for every row.")

        pooled = metric_fn(y, oof)
        baseline_metrics = metric_fn(y, baseline_oof)
        ci_metric = "f1_macro" if args.task == "classification" else "mae"
        ci = _group_bootstrap_ci(y, oof, groups, metric_fn, ci_metric, args.seed)
        metrics = {
            **pooled,
            **{f"baseline_{name}": value for name, value in baseline_metrics.items()},
            f"{ci_metric}_ci95_low": ci[0],
            f"{ci_metric}_ci95_high": ci[1],
        }
        final_model = clone(template)
        fit_kwargs = {}
        if args.task == "classification" and model_type == "xgb":
            fit_kwargs["model__sample_weight"] = compute_sample_weight("balanced", y)
        final_model.fit(x, y, **fit_kwargs)

        version = f"{args.exercise}_{model_type}_v{schema.version}"
        artifact_path = output_dir / f"{version}.joblib"
        joblib.dump(final_model, artifact_path)
        estimator = final_model.named_steps["model"]
        importances = getattr(estimator, "feature_importances_", None)
        metadata = {
            "version": version,
            "exercise": args.exercise,
            "feature_schema_version": schema.version,
            "model_type": model_type,
            "task": args.task,
            "feature_names": list(feature_names),
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics,
            "baseline_metrics": baseline_metrics,
            "target_column": args.target,
            "group_column": args.group,
            "source_datasets": sorted(frame["dataset"].dropna().astype(str).unique().tolist()) if "dataset" in frame else [],
            "class_labels": class_labels,
            "n_examples": int(len(frame)),
            "n_subjects": int(frame[args.group].nunique()),
            "cv_folds": n_splits,
            "fold_scores": fold_scores,
            "confusion_matrix": confusion_matrix(y, oof).tolist() if args.task == "classification" else None,
            "global_feature_importance": dict(zip(feature_names, map(float, importances))) if importances is not None else {},
        }
        metadata_path = output_dir / f"{version}.json"
        metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        artifacts.extend([artifact_path, metadata_path])
        print(f"{version}: {json.dumps(metrics, sort_keys=True)}")

    return artifacts


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("features", type=Path, help="CSV with one FR-5 feature row per rep")
    parser.add_argument("--target", default="label", help="Target column (binary label or clinical score)")
    parser.add_argument("--group", default="subject_id", help="Subject grouping column; random rep splits are prohibited")
    parser.add_argument("--task", choices=("classification", "regression"), required=True)
    parser.add_argument(
        "--exercise",
        choices=tuple(sorted(EXERCISE_FEATURE_SCHEMAS)),
        default="squat",
        help="Exercise module selecting the canonical input feature schema (default: squat)",
    )
    parser.add_argument("--models", nargs="+", choices=("rf", "xgb"), default=("rf", "xgb"))
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output-dir", type=Path, default=project_root / "models" / "quality")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        train(parse_args())
    except (ValueError, FileNotFoundError) as exc:
        raise SystemExit(f"Training stopped: {exc}") from exc
