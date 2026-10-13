import { createBilateralKneeStrategy, type KneeAngleSample } from './bilateral-knee-strategy';

function gradient(values: number[], times: number[]) {
  return values.map((value, index) => {
    if (index === 0) return (values[1] - value) / (times[1] - times[0]);
    if (index === values.length - 1) return (value - values[index - 1]) / (times[index] - times[index - 1]);
    const before = times[index] - times[index - 1];
    const after = times[index + 1] - times[index];
    if (before <= 0 || after <= 0) return 0;
    return (-after / (before * (before + after))) * values[index - 1]
      + ((after - before) / (before * after)) * value
      + (before / (after * (before + after))) * values[index + 1];
  });
}

function squatModelFeatures(samples: KneeAngleSample[]) {
  const kneeSamples = samples.filter((sample) => sample.leftKnee !== null && sample.rightKnee !== null);
  const hipSamples = samples.filter((sample) => sample.leftHip !== null && sample.rightHip !== null);
  const trunkSamples = samples.filter((sample) => sample.trunkLean !== null);
  if (kneeSamples.length < 5 || hipSamples.length < 1 || trunkSamples.length < 1) return null;
  const bottom = kneeSamples.reduce((lowest, sample) => sample.primaryKnee < lowest.primaryKnee ? sample : lowest);
  const startTime = samples[0]?.time;
  const endTime = samples.at(-1)?.time;
  if (startTime === undefined || endTime === undefined || endTime <= startTime) return null;
  const nearestTrunk = trunkSamples.reduce((nearest, sample) => Math.abs(sample.time - bottom.time) < Math.abs(nearest.time - bottom.time) ? sample : nearest);
  const times = kneeSamples.map((sample) => sample.time);
  const leftAngles = kneeSamples.map((sample) => sample.leftKnee as number);
  const velocity = gradient(leftAngles, times);
  const acceleration = gradient(velocity, times);
  const jerk = gradient(acceleration, times);
  const meanJerk = jerk.reduce((sum, value) => sum + value, 0) / jerk.length;
  const variance = jerk.reduce((sum, value) => sum + (value - meanJerk) ** 2, 0) / jerk.length;
  return {
    min_left_knee_angle: Math.min(...leftAngles),
    min_right_knee_angle: Math.min(...kneeSamples.map((sample) => sample.rightKnee as number)),
    knee_asymmetry: Math.abs((bottom.leftKnee as number) - (bottom.rightKnee as number)),
    min_hip_angle: Math.min(...hipSamples.flatMap((sample) => [sample.leftHip as number, sample.rightHip as number])),
    max_trunk_lean: Math.max(...trunkSamples.map((sample) => sample.trunkLean as number)),
    trunk_lean_at_bottom: nearestTrunk.trunkLean as number,
    duration: endTime - startTime,
    descent_time: Math.max(0, bottom.time - startTime),
    ascent_time: Math.max(0, endTime - bottom.time),
    smoothness: Math.sqrt(variance),
  };
}

const config = {
  signalDirection: 'decrease' as const,
  kneeLandmarkVisibility: 0.65,
  minimumBilateralTravelRatio: 0.35,
  minimumBilateralMovementFraction: 0.5,
  minimumBilateralMovementDegrees: 10,
  maximumCountedKneeAsymmetryDegrees: 45,
  minimumSideVisibleFrames: 3,
  minimumPairedFrames: 3,
  earlyWindowFraction: 0.35,
  minimumEarlyWindowFrames: 3,
  minimumStartVisibleFraction: 0.25,
};

export function createSquatStrategy() {
  return createBilateralKneeStrategy({ ...config, modelFeatureBuilder: squatModelFeatures });
}
