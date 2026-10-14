"""Evidence-linked coaching advice from patient plan limits and rep measurements."""

import math
import re
from typing import Any


METRIC_LABELS = {
    "knee_angle": "knee bend at the target position",
    "trunk_lean": "forward trunk lean",
    "asymmetry": "left-right knee difference",
    "hip_angle": "hip angle at the target position",
    "tempo": "rep duration",
    "smoothness": "movement smoothness",
}


def personalized_advice(measurements: list[dict[str, Any]], parameters: list[Any]) -> list[dict[str, Any]]:
    """Compare measurements to active therapist limits and explain each exception."""
    advice: list[dict[str, Any]] = []
    for measurement in measurements:
        metric = str(measurement.get("metric", ""))
        side = str(measurement.get("side", "either"))
        phase = str(measurement.get("phase", "at_bottom"))
        try:
            value = float(measurement["value"])
        except (KeyError, TypeError, ValueError):
            continue
        matches = [p for p in parameters if p.metric == metric and p.phase == phase and p.side in (side, "either")]
        if not matches:
            continue
        minimums = [p.min_value for p in matches if p.min_value is not None]
        maximums = [p.max_value for p in matches if p.max_value is not None]
        minimum = max(minimums) if minimums else None
        maximum = min(maximums) if maximums else None
        tolerance = max((p.tolerance or 0.0) for p in matches)
        unit = matches[0].unit
        below = minimum is not None and value < minimum - tolerance
        above = maximum is not None and value > maximum + tolerance
        if not below and not above:
            continue
        label = METRIC_LABELS.get(metric, metric.replace("_", " "))
        if metric == "knee_angle" and below:
            message = f"This rep reached {value:.0f}° at the bottom, below your prescribed minimum of {minimum:g}°. Use less knee bend and stay within your therapist-set range."
        elif metric == "knee_angle" and above:
            message = f"This rep reached {value:.0f}° at the bottom, above your prescribed maximum of {maximum:g}°. If comfortable and prescribed, bend a little further toward your target range."
        elif metric in {"trunk_lean", "asymmetry"} and above:
            cue = "Keep your chest a little more upright" if metric == "trunk_lean" else "Try to share the movement more evenly between both legs"
            message = f"Your {label} was {value:.1f}{unit}; your plan allows up to {maximum:g}{unit}. {cue}."
        elif below:
            message = f"Your {label} was {value:.1f}{unit}, below your plan minimum of {minimum:g}{unit}."
        else:
            message = f"Your {label} was {value:.1f}{unit}, above your plan maximum of {maximum:g}{unit}."
        advice.append({
            "code": f"plan_{metric}_{'below_min' if below else 'above_max'}",
            "source": "therapist_plan",
            "metric": metric,
            "side": side,
            "phase": phase,
            "measured_value": value,
            "min_value": minimum,
            "max_value": maximum,
            "unit": unit,
            "message": message,
        })
    return advice


def trend_advice(recent_sessions: list[list[dict[str, Any]]], parameters: list[Any]) -> list[dict[str, Any]]:
    """Flag repeated out-of-plan patterns across recent saved sessions.

    A pattern is reported only when it appears in at least two distinct sessions
    and in at least half of the measurable reps for that metric in each session.
    Historical values are compared with the currently active therapist plan.
    """
    if len(recent_sessions) < 2:
        return []

    repeated: list[dict[str, Any]] = []
    for parameter in parameters:
        metric = str(parameter.metric)
        phase = str(parameter.phase)
        side = str(parameter.side)
        pattern = re.compile(rf"^{re.escape(metric)}_(left|right|either)_{re.escape(phase)}$")
        flagged_sessions = 0
        directions: list[str] = []
        for session_reps in recent_sessions:
            measured = 0
            outside = 0
            session_directions: list[str] = []
            for rep in session_reps:
                measurements = rep.get("measurements")
                if not isinstance(measurements, dict):
                    continue
                values: list[float] = []
                for key, raw in measurements.items():
                    match = pattern.fullmatch(str(key))
                    if not match or (side != "either" and match.group(1) not in (side, "either")):
                        continue
                    raw_value = raw.get("value") if isinstance(raw, dict) else raw
                    try:
                        value = float(raw_value)
                        if math.isfinite(value):
                            values.append(value)
                    except (TypeError, ValueError):
                        continue
                if not values:
                    continue
                measured += 1
                # For bilateral values, either side being outside counts as a flagged rep.
                minimum = parameter.min_value
                maximum = parameter.max_value
                tolerance = float(parameter.tolerance or 0.0)
                states = [
                    "below" if minimum is not None and value < minimum - tolerance
                    else "above" if maximum is not None and value > maximum + tolerance
                    else "within"
                    for value in values
                ]
                if any(state != "within" for state in states):
                    outside += 1
                    session_directions.extend(state for state in states if state != "within")
            if measured and outside / measured >= 0.5:
                flagged_sessions += 1
                directions.extend(session_directions)

        if flagged_sessions < 2:
            continue
        direction = max(("below", "above"), key=directions.count) if directions else "outside"
        label = METRIC_LABELS.get(metric, metric.replace("_", " "))
        if direction == "below":
            boundary = f"below {parameter.min_value:g}{parameter.unit}" if parameter.min_value is not None else "below the prescribed range"
        elif direction == "above":
            boundary = f"above {parameter.max_value:g}{parameter.unit}" if parameter.max_value is not None else "above the prescribed range"
        else:
            boundary = "outside the prescribed range"
        repeated.append({
            "code": f"repeated_{metric}_{side}_{phase}",
            "source": "recent_sessions_and_therapist_plan",
            "metric": metric,
            "side": side,
            "phase": phase,
            "sessions_flagged": flagged_sessions,
            "sessions_reviewed": len(recent_sessions),
            "message": f"Recent sessions show {label} {boundary} in at least half of measurable reps in {flagged_sessions} of {len(recent_sessions)} sessions. Review this movement with your therapist; keep following your current prescribed range.",
        })
    return repeated
