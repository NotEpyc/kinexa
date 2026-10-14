"""Evidence-linked coaching advice from patient plan limits and rep measurements."""

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
