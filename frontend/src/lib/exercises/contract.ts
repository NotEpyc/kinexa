/** Exercise-neutral types shared by the live session and exercise strategies. */
export type PosePoint = { x: number; y: number; z: number; visibility?: number };

export type LiveRepSample = {
  time: number;
  primarySignal: number;
  signals: Record<string, number | null>;
};

export type ExerciseConstraints = Record<string, { min?: number | null; max?: number | null }>;

export type RepValidationContext = {
  excursion: number;
  minimumMovement: number;
  duration: number;
  minimumDuration: number;
  gap: number | null;
  minimumGap: number;
};

export type RepValidationResult = {
  accepted: boolean;
  reason: string;
  diagnostics: Record<string, number | null>;
};

export type RepQualityAssessment = {
  primaryMetric: { name: string; label: string; value: number; unit: string };
  metrics: Array<{ name: string; label: string; value: number | null; unit: string }>;
  feedbackStatus: 'within_limits' | 'outside_limits' | 'limits_not_set' | 'not_assessable';
  cues: string[];
  modelFeatures: Record<string, number> | null;
};

export interface LiveExerciseStrategy<TSample extends LiveRepSample = LiveRepSample> {
  /** Convert pose landmarks to the signals needed by this exercise. */
  samplePose(
    worldLandmarks: PosePoint[],
    screenLandmarks: PosePoint[],
    timestamp: number,
    visibilityThreshold: number,
  ): TSample | null;
  /** Reject false cycles using exercise-specific movement checks. */
  validateRep(samples: TSample[], context: RepValidationContext): RepValidationResult;
  /** Apply patient constraints and create the exercise model feature vector. */
  assessRep(samples: TSample[], constraints: ExerciseConstraints): RepQualityAssessment;
}
