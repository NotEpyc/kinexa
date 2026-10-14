"""Default squat assessment parameters used when no patient plan is available."""

from ..rules.engine import Metric, Parameter, Phase, RulesEngine


def build_squat_rules(patient_id: str, parameters=None) -> RulesEngine:
    """Build a rules engine from the active therapist plan, with safe defaults."""
    if parameters:
        return RulesEngine(parameters)
    defaults = [
        Parameter(
            id="default_knee_min", plan_id="default", metric="knee_angle", side="either",
            phase="at_bottom", min_value=90.0, max_value=None, unit="deg", tolerance=5.0,
            effective_from="2024-01-01T00:00:00", effective_to=None, version=1,
        ),
        Parameter(
            id="default_knee_max", plan_id="default", metric="knee_angle", side="either",
            phase="at_bottom", min_value=None, max_value=130.0, unit="deg", tolerance=5.0,
            effective_from="2024-01-01T00:00:00", effective_to=None, version=1,
        ),
        Parameter(
            id="default_trunk_max", plan_id="default", metric="trunk_lean", side="either",
            phase="at_bottom", min_value=None, max_value=25.0, unit="deg", tolerance=3.0,
            effective_from="2024-01-01T00:00:00", effective_to=None, version=1,
        ),
        Parameter(
            id="default_asym_max", plan_id="default", metric="asymmetry", side="either",
            phase="at_bottom", min_value=None, max_value=10.0, unit="deg", tolerance=2.0,
            effective_from="2024-01-01T00:00:00", effective_to=None, version=1,
        ),
    ]
    return RulesEngine(defaults)
