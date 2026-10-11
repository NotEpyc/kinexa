"""Canonical feature schemas registered by exercise.

Add an exercise here once its feature extractor and validated training data exist.
Training artifacts are exercise-specific, while the loader/inference contract is shared.
"""

from dataclasses import dataclass

from .squat import SQUAT_MODEL_FEATURES


@dataclass(frozen=True)
class ExerciseFeatureSchema:
    exercise: str
    version: int
    feature_names: tuple[str, ...]
    default_model_type: str = "rf"

    @property
    def default_model_version(self) -> str:
        return f"{self.exercise}_{self.default_model_type}_v{self.version}"


EXERCISE_FEATURE_SCHEMAS: dict[str, ExerciseFeatureSchema] = {
    "squat": ExerciseFeatureSchema(
        exercise="squat",
        version=1,
        feature_names=SQUAT_MODEL_FEATURES,
    ),
}


def get_feature_schema(exercise: str) -> ExerciseFeatureSchema:
    """Return the feature schema for a supported exercise."""
    try:
        return EXERCISE_FEATURE_SCHEMAS[exercise]
    except KeyError as exc:
        supported = ", ".join(sorted(EXERCISE_FEATURE_SCHEMAS))
        raise ValueError(f"No ML feature schema registered for '{exercise}'. Supported: {supported}") from exc
