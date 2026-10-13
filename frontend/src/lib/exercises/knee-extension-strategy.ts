import { createBilateralKneeStrategy } from './bilateral-knee-strategy';

/**
 * Rules-only bilateral seated knee extension strategy. It reuses the knee-angle
 * geometry, but reverses the target direction: straightening increases the angle.
 */
export function createKneeExtensionStrategy() {
  return createBilateralKneeStrategy({
    signalDirection: 'increase',
    kneeLandmarkVisibility: 0.65,
    minimumBilateralTravelRatio: 0.35,
    minimumBilateralMovementFraction: 0.5,
    minimumBilateralMovementDegrees: 8,
    maximumCountedKneeAsymmetryDegrees: 45,
    minimumSideVisibleFrames: 3,
    minimumPairedFrames: 3,
    earlyWindowFraction: 0.35,
    minimumEarlyWindowFrames: 3,
    minimumStartVisibleFraction: 0.25,
  });
}
