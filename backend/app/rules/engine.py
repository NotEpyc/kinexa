"""ROM rules engine and decision layer."""

from dataclasses import dataclass
from typing import Optional, List
from enum import Enum


class Side(str, Enum):
    LEFT = "left"
    RIGHT = "right"
    EITHER = "either"


class Phase(str, Enum):
    AT_BOTTOM = "at_bottom"
    AT_PEAK = "at_peak"
    WHOLE_REP = "whole_rep"


class Metric(str, Enum):
    KNEE_ANGLE = "knee_angle"
    HIP_ANGLE = "hip_angle"
    TRUNK_LEAN = "trunk_lean"
    ASYMMETRY = "asymmetry"
    TEMPO = "tempo"
    SMOOTHNESS = "smoothness"


class Verdict(str, Enum):
    PASS = "pass"
    FLAG = "flag"
    ADVISORY = "advisory"
    NOT_ASSESSABLE = "not_assessable"


@dataclass
class Parameter:
    """Therapist-defined ROM parameter (maps to patient_exercise_parameters table)."""
    id: str
    plan_id: str
    metric: Metric
    side: Side
    phase: Phase
    min_value: Optional[float]
    max_value: Optional[float]
    unit: str
    tolerance: Optional[float]
    effective_from: str  # ISO datetime
    effective_to: Optional[str]
    version: int


@dataclass
class Measurement:
    """Single measurement from feature extraction."""
    metric: Metric
    side: Side
    phase: Phase
    value: float
    unit: str


@dataclass
class Flag:
    """Rule violation or advisory flag."""
    code: str
    message: str
    severity: Verdict
    metric: Metric
    side: Side
    phase: Phase
    measured_value: float
    limit_value: Optional[float]


@dataclass
class RepAssessment:
    """Complete per-rep assessment."""
    rep_index: int
    status: Verdict
    measurements: List[Measurement]
    ml_output: Optional[dict] = None
    flags: List[Flag] = None
    # Timestamps from feature extraction
    start_time: float = 0.0
    bottom_time: float = 0.0
    end_time: float = 0.0
    
    def __post_init__(self):
        if self.flags is None:
            self.flags = []


class RulesEngine:
    """
    Evaluates measurements against therapist-defined parameters.
    
    Decision logic (PRD FR-7.2, FR-7.3):
    - Therapist limits take precedence over ML
    - Rep flagged if violates ANY patient limit
    - Inside limits: ML shown as advisory only
    - No therapist limits: default population limits apply
    """
    
    # Default population limits (fallback when no therapist limits)
    DEFAULTS = {
        (Metric.KNEE_ANGLE, Side.EITHER, Phase.AT_BOTTOM): (90.0, 130.0),  # min, max
        (Metric.TRUNK_LEAN, Side.EITHER, Phase.AT_BOTTOM): (None, 25.0),
        (Metric.ASYMMETRY, Side.EITHER, Phase.AT_BOTTOM): (None, 10.0),
    }
    
    def __init__(self, parameters: List[Parameter]):
        self.parameters = parameters
    
    def evaluate(self, measurements: List[Measurement], ml_output: Optional[dict] = None) -> RepAssessment:
        """
        Evaluate measurements against therapist parameters.
        
        Returns RepAssessment with flags and final verdict.
        """
        flags = []
        
        for measurement in measurements:
            # Find all matching therapist parameters
            params = self._find_parameters(measurement)
            
            if params:
                # Therapist limits exist - evaluate against each
                for param in params:
                    flag = self._check_against_parameter(measurement, param)
                    if flag:
                        flags.append(flag)
            else:
                # No therapist limit - use default
                flag = self._check_against_default(measurement)
                if flag:
                    flags.append(flag)
        
        # Determine overall verdict
        has_violation = any(f.severity == Verdict.FLAG for f in flags)
        has_advisory = any(f.severity == Verdict.ADVISORY for f in flags)
        
        if has_violation:
            status = Verdict.FLAG
        elif has_advisory:
            status = Verdict.ADVISORY
        else:
            status = Verdict.PASS
        
        return RepAssessment(
            rep_index=0,  # Set by caller
            status=status,
            measurements=measurements,
            ml_output=ml_output,
            flags=flags,
        )
    
    def _find_parameters(self, measurement: Measurement) -> List[Parameter]:
        """Find all matching therapist parameters for a measurement."""
        matches = []
        for param in self.parameters:
            if (param.metric == measurement.metric and
                (param.side == measurement.side or param.side == Side.EITHER) and
                param.phase == measurement.phase):
                matches.append(param)
        return matches
    
    def _check_against_parameter(self, measurement: Measurement, param: Parameter) -> Optional[Flag]:
        """Check measurement against therapist parameter."""
        value = measurement.value
        code = None
        message = None
        
        if param.min_value is not None and value < param.min_value - (param.tolerance or 0):
            code = f"{measurement.metric.value}_below_min"
            message = f"{measurement.metric.value} {value:.1f}{measurement.unit} below minimum {param.min_value}{measurement.unit}"
        elif param.max_value is not None and value > param.max_value + (param.tolerance or 0):
            code = f"{measurement.metric.value}_above_max"
            message = f"{measurement.metric.value} {value:.1f}{measurement.unit} above maximum {param.max_value}{measurement.unit}"
        
        if code:
            return Flag(
                code=code,
                message=message,
                severity=Verdict.FLAG,  # Therapist violation = FLAG
                metric=measurement.metric,
                side=measurement.side,
                phase=measurement.phase,
                measured_value=value,
                limit_value=param.min_value if code and 'below' in code else param.max_value,
            )
        return None
    
    def _check_against_default(self, measurement: Measurement) -> Optional[Flag]:
        """Check measurement against default population limits."""
        key = (measurement.metric, measurement.side, measurement.phase)
        default = self.DEFAULTS.get(key)
        
        if not default:
            return None
        
        min_val, max_val = default
        value = measurement.value
        code = None
        message = None
        
        if min_val is not None and value < min_val:
            code = f"{measurement.metric.value}_below_default_min"
            message = f"{measurement.metric.value} {value:.1f}{measurement.unit} below default minimum {min_val}{measurement.unit}"
        elif max_val is not None and value > max_val:
            code = f"{measurement.metric.value}_above_default_max"
            message = f"{measurement.metric.value} {value:.1f}{measurement.unit} above default maximum {max_val}{measurement.unit}"
        
        if code:
            return Flag(
                code=code,
                message=message,
                severity=Verdict.FLAG,
                metric=measurement.metric,
                side=measurement.side,
                phase=measurement.phase,
                measured_value=value,
                limit_value=min_val if code and 'below' in code else max_val,
            )
        return None