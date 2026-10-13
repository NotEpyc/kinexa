import { createSquatStrategy } from './exercises/squat-strategy';
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
    strategy: createSquatStrategy({
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
    }),
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
};

export function getLiveExercise(exerciseId: string): LiveExerciseDefinition {
  const definition = LIVE_EXERCISES[exerciseId];
  if (!definition) throw new Error(`Live exercise '${exerciseId}' is not implemented.`);
  return definition;
}
