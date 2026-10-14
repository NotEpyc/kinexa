"""Registry of implemented exercise analysis modules.

An exercise is listed only after its analyzer exists. Adding a new exercise
does not require changing the upload route's dispatch logic.
"""

from dataclasses import dataclass
from typing import Callable, Type

from ..rules.engine import RulesEngine
from .squat import SquatExercise
from .squat_rules import build_squat_rules


@dataclass(frozen=True)
class ExerciseModule:
    name: str
    analyzer: Type
    build_rules: Callable[..., RulesEngine]


EXERCISES: dict[str, ExerciseModule] = {
    "squat": ExerciseModule(name="squat", analyzer=SquatExercise, build_rules=build_squat_rules),
}


def get_exercise(exercise: str) -> ExerciseModule | None:
    """Return an implemented exercise module, if registered."""
    return EXERCISES.get(exercise)


def supported_exercises() -> tuple[str, ...]:
    return tuple(sorted(EXERCISES))
