import { createSquatStrategy } from './exercises/squat-strategy';
import { createKneeExtensionStrategy } from './exercises/knee-extension-strategy';
import type { LiveExerciseStrategy } from './exercises/contract';

/** Live movement contracts. Add an exercise only after its own detector and checks exist. */
export type ExerciseReadiness = 'rules_only' | 'model_advisory' | 'camera_validated';

export type LiveExerciseDefinition = {
  id: string;
  label: string;
  signals: readonly { id: string; kind: 'joint_angle'; joints: readonly [string, string, string]; side: 'left' | 'right' | 'either' }[];
  descentDirection: 'decrease' | 'increase';
  phases: readonly string[];
  readiness: ExerciseReadiness;
  readinessMessage: string;
  strategy: LiveExerciseStrategy<any>;
  angleLabel: string;
  targetPositionLabel: string;
  cameraGuidance: string;
  detector: {
    minRepMovementDegrees: number;
    minimumUserMovementDegrees: number;
    maximumUserMovementDegrees: number;
    startThresholdFraction: number;
    startThresholdMinDegrees: number;
    startThresholdMaxDegrees: number;
    minimumRepDurationSeconds: number;
    minimumRepGapSeconds: number;
    minimumBilateralTravelRatio: number;
    minimumBilateralMovementFraction: number;
    minimumBilateralMovementDegrees: number;
    maximumCountedKneeAsymmetryDegrees: number;
    kneeLandmarkVisibility: number;
    baselineAdaptationDegreesPerSecond: number;
    maxStandingReturnOffsetDegrees: number;
    returnFromBottomFraction: number;
    returnOffsetFloorDegrees: number;
    minimumRiseFromBottomDegrees: number;
    smoothingPreviousWeight: number;
    defaultFrameRate: number;
    maxBaselineUpdateIntervalSeconds: number;
    earlyWindowFraction: number;
    minimumEarlyWindowFrames: number;
    minimumStartVisibleFraction: number;
    minimumSideVisibleFrames: number;
    minimumPairedFrames: number;
  };
};

export const LIVE_EXERCISES: Record<string, LiveExerciseDefinition> = {
  squat: {
    id: 'squat',
    label: 'Squat',
    signals: [
      { id: 'left_knee_angle', kind: 'joint_angle', joints: ['left_hip', 'left_knee', 'left_ankle'], side: 'left' },
      { id: 'right_knee_angle', kind: 'joint_angle', joints: ['right_hip', 'right_knee', 'right_ankle'], side: 'right' },
    ],
    descentDirection: 'decrease',
    phases: ['standing', 'descent', 'bottom', 'ascent', 'standing'],
    readiness: 'model_advisory',
    readinessMessage: 'Research model is trained on motion-capture data; live-camera performance is not validated.',
    angleLabel: 'Knee angle',
    targetPositionLabel: 'at the bottom of each rep',
    cameraGuidance: 'Side-on · Full body in frame',
    strategy: createSquatStrategy(),
    detector: {
      minRepMovementDegrees: 20,
      minimumUserMovementDegrees: 8,
      maximumUserMovementDegrees: 45,
      startThresholdFraction: 0.5,
      startThresholdMinDegrees: 6,
      startThresholdMaxDegrees: 14,
      minimumRepDurationSeconds: 0.7,
      minimumRepGapSeconds: 0.8,
      minimumBilateralTravelRatio: 0.35,
      minimumBilateralMovementFraction: 0.5,
      minimumBilateralMovementDegrees: 10,
      maximumCountedKneeAsymmetryDegrees: 45,
      kneeLandmarkVisibility: 0.65,
      baselineAdaptationDegreesPerSecond: 2,
      maxStandingReturnOffsetDegrees: 18,
      returnFromBottomFraction: 0.65,
      returnOffsetFloorDegrees: 10,
      minimumRiseFromBottomDegrees: 8,
      smoothingPreviousWeight: 0.72,
      defaultFrameRate: 30,
      maxBaselineUpdateIntervalSeconds: 0.2,
      earlyWindowFraction: 0.35,
      minimumEarlyWindowFrames: 3,
      minimumStartVisibleFraction: 0.25,
      minimumSideVisibleFrames: 3,
      minimumPairedFrames: 3,
    },
  },
  knee_extension: {
    id: 'knee_extension',
    label: 'Bilateral seated knee extension',
    signals: [
      { id: 'left_knee_angle', kind: 'joint_angle', joints: ['left_hip', 'left_knee', 'left_ankle'], side: 'left' },
      { id: 'right_knee_angle', kind: 'joint_angle', joints: ['right_hip', 'right_knee', 'right_ankle'], side: 'right' },
    ],
    descentDirection: 'increase',
    phases: ['flexed start', 'extension', 'straightened target', 'return', 'flexed start'],
    readiness: 'rules_only',
    readinessMessage: 'Bilateral knee-extension feedback uses pose landmarks and movement rules; no quality model is trained or validated for this exercise.',
    angleLabel: 'Knee extension angle',
    targetPositionLabel: 'at the straightened point of each rep',
    cameraGuidance: 'Side-on · Sit upright with both legs visible',
    strategy: createKneeExtensionStrategy(),
    detector: {
      minRepMovementDegrees: 20,
      minimumUserMovementDegrees: 8,
      maximumUserMovementDegrees: 45,
      startThresholdFraction: 0.5,
      startThresholdMinDegrees: 6,
      startThresholdMaxDegrees: 14,
      minimumRepDurationSeconds: 0.7,
      minimumRepGapSeconds: 0.8,
      minimumBilateralTravelRatio: 0.35,
      minimumBilateralMovementFraction: 0.5,
      minimumBilateralMovementDegrees: 8,
      maximumCountedKneeAsymmetryDegrees: 45,
      kneeLandmarkVisibility: 0.65,
      baselineAdaptationDegreesPerSecond: 2,
      maxStandingReturnOffsetDegrees: 18,
      returnFromBottomFraction: 0.65,
      returnOffsetFloorDegrees: 10,
      minimumRiseFromBottomDegrees: 8,
      smoothingPreviousWeight: 0.72,
      defaultFrameRate: 30,
      maxBaselineUpdateIntervalSeconds: 0.2,
      earlyWindowFraction: 0.35,
      minimumEarlyWindowFrames: 3,
      minimumStartVisibleFraction: 0.25,
      minimumSideVisibleFrames: 3,
      minimumPairedFrames: 3,
    },
  },
};

export function getLiveExercise(exerciseId: string): LiveExerciseDefinition {
  const definition = LIVE_EXERCISES[exerciseId];
  if (!definition) throw new Error(`Live exercise '${exerciseId}' is not implemented.`);
  return definition;
}
