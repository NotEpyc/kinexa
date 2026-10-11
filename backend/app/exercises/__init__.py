"""Exercise-specific analysis modules and registry."""

from .squat import SquatExercise
from .registry import EXERCISES, ExerciseModule, get_exercise, supported_exercises

__all__ = ["SquatExercise", "ExerciseModule", "EXERCISES", "get_exercise", "supported_exercises"]
