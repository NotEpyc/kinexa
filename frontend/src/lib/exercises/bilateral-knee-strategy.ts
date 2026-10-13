import type {
  ExerciseConstraints,
  LiveExerciseStrategy,
  LiveRepSample,
  PosePoint,
  RepQualityAssessment,
  RepValidationContext,
  RepValidationResult,
} from './contract';

/** Bilateral knee signals shared by exercises that use the same joint geometry. */
export type KneeAngleSample = LiveRepSample & {
  leftKnee: number | null;
  rightKnee: number | null;
  leftHip: number | null;
  rightHip: number | null;
  primaryKnee: number;
  trunkLean: number | null;
};

export type BilateralKneeConfig = {
  signalDirection?: 'decrease' | 'increase';
  modelFeatureBuilder?: (samples: KneeAngleSample[]) => Record<string, number> | null;
  kneeLandmarkVisibility: number;
  minimumBilateralTravelRatio: number;
  minimumBilateralMovementFraction: number;
  minimumBilateralMovementDegrees: number;
  maximumCountedKneeAsymmetryDegrees: number;
  minimumSideVisibleFrames: number;
  minimumPairedFrames: number;
  earlyWindowFraction: number;
  minimumEarlyWindowFrames: number;
  minimumStartVisibleFraction: number;
};

const KNEE = { left: [23, 25, 27] as const, right: [24, 26, 28] as const };

function jointAngle(a: PosePoint, b: PosePoint, c: PosePoint) {
  const ba = [a.y - b.y, a.z - b.z];
  const bc = [c.y - b.y, c.z - b.z];
  const denominator = Math.hypot(ba[0], ba[1]) * Math.hypot(bc[0], bc[1]);
  if (!denominator) return null;
  const cosine = Math.max(-1, Math.min(1, (ba[0] * bc[0] + ba[1] * bc[1]) / denominator));
  return Math.round((Math.acos(cosine) * 180) / Math.PI);
}

function visible(screen: PosePoint[], indices: readonly number[], threshold: number) {
  return indices.every((index) => (screen[index]?.visibility ?? 0) >= threshold);
}

function trunkLean(points: PosePoint[], screen: PosePoint[]) {
  if (![11, 12, 23, 24].every((index) => (screen[index]?.visibility ?? 0) >= 0.45)) return null;
  const shoulderY = (points[11].y + points[12].y) / 2;
  const hipY = (points[23].y + points[24].y) / 2;
  const shoulderZ = (points[11].z + points[12].z) / 2;
  const hipZ = (points[23].z + points[24].z) / 2;
  return Math.round((Math.atan2(Math.abs(shoulderZ - hipZ), Math.abs(shoulderY - hipY)) * 180) / Math.PI);
}

export function createBilateralKneeStrategy(config: BilateralKneeConfig): LiveExerciseStrategy<KneeAngleSample> {
  const direction = config.signalDirection ?? 'decrease';
  return {
    samplePose(points, screen, timestamp, threshold) {
      if (!visible(screen, KNEE.left, threshold) && !visible(screen, KNEE.right, threshold)) return null;
      const leftVisible = visible(screen, KNEE.left, threshold);
      const rightVisible = visible(screen, KNEE.right, threshold);
      const leftKnee = leftVisible ? jointAngle(points[23], points[25], points[27]) : null;
      const rightKnee = rightVisible ? jointAngle(points[24], points[26], points[28]) : null;
      const leftHip = leftVisible && (screen[11]?.visibility ?? 0) >= threshold ? jointAngle(points[11], points[23], points[25]) : null;
      const rightHip = rightVisible && (screen[12]?.visibility ?? 0) >= threshold ? jointAngle(points[12], points[24], points[26]) : null;
      const primaryKnee = leftKnee !== null && rightKnee !== null
        ? (Math.min(screen[23].visibility ?? 0, screen[25].visibility ?? 0, screen[27].visibility ?? 0) >= Math.min(screen[24].visibility ?? 0, screen[26].visibility ?? 0, screen[28].visibility ?? 0) ? leftKnee : rightKnee)
        : leftKnee ?? rightKnee;
      if (primaryKnee === null) return null;
      return {
        time: timestamp,
        primarySignal: primaryKnee,
        signals: { left_knee_angle: leftKnee, right_knee_angle: rightKnee, left_hip_angle: leftHip, right_hip_angle: rightHip, trunk_lean: trunkLean(points, screen) },
        leftKnee, rightKnee, leftHip, rightHip, primaryKnee,
        trunkLean: trunkLean(points, screen),
      };
    },
    validateRep(samples, context: RepValidationContext): RepValidationResult {
      const targetPosition = direction === 'decrease' ? 'bottom' : 'extended position';
      const early = samples.slice(0, Math.max(config.minimumEarlyWindowFrames, Math.ceil(samples.length * config.earlyWindowFraction)));
      const leftEarly = early.flatMap((sample) => sample.leftKnee === null ? [] : [sample.leftKnee]);
      const rightEarly = early.flatMap((sample) => sample.rightKnee === null ? [] : [sample.rightKnee]);
      const leftValues = samples.flatMap((sample) => sample.leftKnee === null ? [] : [sample.leftKnee]);
      const rightValues = samples.flatMap((sample) => sample.rightKnee === null ? [] : [sample.rightKnee]);
      const startFrames = Math.min(config.minimumEarlyWindowFrames, Math.max(1, Math.ceil(early.length * config.minimumStartVisibleFraction)));
      const directedExcursion = (earlyValues: number[], values: number[]) => direction === 'decrease'
        ? Math.max(...earlyValues) - Math.min(...values)
        : Math.max(...values) - Math.min(...earlyValues);
      const leftExcursion = leftEarly.length >= startFrames && leftValues.length >= config.minimumSideVisibleFrames ? directedExcursion(leftEarly, leftValues) : null;
      const rightExcursion = rightEarly.length >= startFrames && rightValues.length >= config.minimumSideVisibleFrames ? directedExcursion(rightEarly, rightValues) : null;
      const paired = samples.filter((sample) => sample.leftKnee !== null && sample.rightKnee !== null);
      const deepest = paired.reduce<KneeAngleSample | null>((best, sample) => {
        const score = sample.leftKnee! + sample.rightKnee!;
        const bestScore = best ? best.leftKnee! + best.rightKnee! : 0;
        return !best || (direction === 'decrease' ? score < bestScore : score > bestScore) ? sample : best;
      }, null);
      const asymmetry = paired.length >= config.minimumPairedFrames && deepest ? Math.abs(deepest.leftKnee! - deepest.rightKnee!) : null;
      const ratio = leftExcursion !== null && rightExcursion !== null ? Math.min(leftExcursion, rightExcursion) / Math.max(leftExcursion, rightExcursion, 1) : null;
      const bilateralMinimum = Math.max(config.minimumBilateralMovementDegrees, Math.round(context.minimumMovement * config.minimumBilateralMovementFraction));
      const reasons: string[] = [];
      if (context.excursion < context.minimumMovement) reasons.push(`movement ${context.excursion.toFixed(1)}° was below ${context.minimumMovement}° minimum`);
      if (leftExcursion === null || rightExcursion === null) reasons.push(`bilateral knee travel could not be confirmed (left visible ${leftValues.length}/${samples.length}, right ${rightValues.length}/${samples.length}); keep both knees and ankles in view`);
      else if (leftExcursion < bilateralMinimum || rightExcursion < bilateralMinimum) reasons.push(`both knees must move at least ${bilateralMinimum}° (left ${leftExcursion.toFixed(1)}°, right ${rightExcursion.toFixed(1)}°)`);
      else if (ratio !== null && ratio < config.minimumBilateralTravelRatio) reasons.push(`knee travel was too one-sided (left ${leftExcursion.toFixed(1)}°, right ${rightExcursion.toFixed(1)}°; weaker side ${Math.round(ratio * 100)}%, minimum ${Math.round(config.minimumBilateralTravelRatio * 100)}%)`);
      if (asymmetry === null) reasons.push(`${targetPosition} knee symmetry could not be confirmed; keep both knees visible throughout the movement`);
      else if (asymmetry > config.maximumCountedKneeAsymmetryDegrees) reasons.push(`${targetPosition} knee angles differed by ${asymmetry.toFixed(1)}°, above the ${config.maximumCountedKneeAsymmetryDegrees}° rep-count limit; this looks like one-sided movement`);
      if (context.duration < context.minimumDuration) reasons.push(`rep duration ${context.duration.toFixed(2)}s was below ${context.minimumDuration}s minimum`);
      if (context.gap !== null && context.gap < context.minimumGap) reasons.push(`rep gap ${context.gap.toFixed(2)}s was below ${context.minimumGap}s minimum`);
      return {
        accepted: reasons.length === 0,
        reason: reasons.join('; ') || 'movement, bilateral travel, symmetry, duration, and spacing thresholds met',
        diagnostics: { left_excursion: leftExcursion, right_excursion: rightExcursion, left_visible_frames: leftValues.length, right_visible_frames: rightValues.length, bottom_asymmetry: asymmetry, bilateral_minimum: bilateralMinimum, bilateral_ratio: ratio },
      };
    },
    assessRep(samples, constraints: ExerciseConstraints): RepQualityAssessment {
      const deepest = samples.reduce((target, sample) => direction === 'decrease'
        ? (sample.primaryKnee < target.primaryKnee ? sample : target)
        : (sample.primaryKnee > target.primaryKnee ? sample : target));
      const asymmetry = deepest.leftKnee !== null && deepest.rightKnee !== null ? Math.abs(deepest.leftKnee - deepest.rightKnee) : null;
      const peakTrunk = samples.reduce((peak, sample) => sample.trunkLean === null ? peak : Math.max(peak ?? 0, sample.trunkLean), null as number | null);
      const metrics = [
        { name: 'knee_angle', label: direction === 'decrease' ? 'Bottom knee angle' : 'Extended knee angle', value: deepest.primaryKnee, unit: '°' },
        { name: 'knee_asymmetry', label: 'Knee asymmetry', value: asymmetry, unit: '°' },
        { name: 'trunk_lean', label: 'Maximum trunk lean', value: peakTrunk, unit: '°' },
      ];
      const cues: string[] = [];
      let outside = false;
      let missing = false;
      for (const metric of metrics) {
        const limit = constraints[metric.name];
        if (!limit || (limit.min == null && limit.max == null)) continue;
        if (metric.value === null) { missing = true; cues.push(`${metric.label} could not be assessed from visible landmarks.`); continue; }
        if (limit.min != null && metric.value < limit.min || limit.max != null && metric.value > limit.max) {
          outside = true;
          cues.push(`${metric.label} was ${metric.value}${metric.unit}, outside the prescribed range.`);
        } else cues.push(`${metric.label} is within the prescribed range.`);
      }
      const anyLimits = Object.values(constraints).some((limit) => limit.min != null || limit.max != null);
      if (!anyLimits) cues.push('Set at least one therapist-prescribed limit to assess this rep.');
      return {
        primaryMetric: { name: 'knee_angle', label: direction === 'decrease' ? 'Bottom knee angle' : 'Extended knee angle', value: deepest.primaryKnee, unit: '°' },
        metrics,
        feedbackStatus: outside ? 'outside_limits' : missing ? 'not_assessable' : anyLimits ? 'within_limits' : 'limits_not_set',
        cues,
        modelFeatures: config.modelFeatureBuilder?.(samples) ?? null,
      };
    },
  };
}
