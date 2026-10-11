'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getLiveExercise } from '@/lib/exercises';
import type { ExerciseReadiness } from '@/lib/exercises';

type Point = { x: number; y: number; z: number; visibility?: number };
type Rep = {
  number: number;
  angle: number;
  asymmetry: number | null;
  maxTrunkLean: number | null;
  duration: number;
  verdict: 'within range' | 'outside range' | 'range not set' | 'not assessable';
  cue: string;
  model: { status: 'checking' | 'available' | 'unavailable'; prediction?: string | number; task?: string; confidence?: number; version?: string; reason?: string };
};
type RepSample = {
  time: number;
  leftKnee: number | null;
  rightKnee: number | null;
  leftHip: number | null;
  rightHip: number | null;
  primaryKnee: number;
  trunkLean: number | null;
};
type AngleHistoryPoint = { seconds: number; leftKnee: number | null; rightKnee: number | null };
type DetectorLog = {
  time: string;
  event: 'started' | 'counted' | 'rejected';
  angle: number;
  baseline: number;
  bottom: number | null;
  excursion: number;
  leftExcursion: number | null;
  rightExcursion: number | null;
  leftVisibleFrames: number | null;
  rightVisibleFrames: number | null;
  repFrames: number | null;
  bottomAsymmetry: number | null;
  minBilateralMovement: number;
  bilateralRatio: number | null;
  triggerThreshold: number;
  minMovement: number;
  duration: number;
  minDuration: number;
  gap: number | null;
  minGap: number;
  reason?: string;
};

const EXERCISE = getLiveExercise('squat');
const DETECTOR = EXERCISE.detector;

const CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32], [27, 29], [29, 31], [28, 30], [30, 32],
];

function angle(a: Point, b: Point, c: Point) {
  const ba = [a.y - b.y, a.z - b.z];
  const bc = [c.y - b.y, c.z - b.z];
  const denominator = Math.hypot(ba[0], ba[1]) * Math.hypot(bc[0], bc[1]);
  if (!denominator) return null;
  const cosine = Math.max(-1, Math.min(1, (ba[0] * bc[0] + ba[1] * bc[1]) / denominator));
  return Math.round((Math.acos(cosine) * 180) / Math.PI);
}

function hasReliableKnee(screen: Point[], indices: [number, number, number]) {
  return indices.every((index) => (screen[index]?.visibility ?? 0) >= DETECTOR.kneeLandmarkVisibility);
}

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

function makeSquatModelFeatures(samples: RepSample[]) {
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
  if (times.length < 5) return null;
  const velocity = gradient(leftAngles, times);
  const acceleration = gradient(velocity, times);
  const jerk = gradient(acceleration, times);
  const meanJerk = jerk.reduce((sum, value) => sum + value, 0) / jerk.length;
  const jerkVariance = jerk.reduce((sum, value) => sum + (value - meanJerk) ** 2, 0) / jerk.length;
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
    smoothness: Math.sqrt(jerkVariance),
  };
}

async function requestExerciseModel(exercise: string, features: Record<string, number> | null) {
  if (!features) return { status: 'unavailable' as const, reason: 'Not enough clearly visible samples to calculate all model features.' };
  try {
    const response = await fetch('/api/quality/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exercise, features }),
    });
    const result = await response.json();
    if (!response.ok || !result.available) {
      return { status: 'unavailable' as const, reason: result.reason || 'Model assessment is unavailable.' };
    }
    return {
      status: 'available' as const,
      prediction: result.assessment?.prediction as string | number | undefined,
      task: result.assessment?.task as string | undefined,
      confidence: result.assessment?.confidence as number | undefined,
      version: result.model_version as string | undefined,
    };
  } catch {
    return { status: 'unavailable' as const, reason: 'Model service is offline; therapist ROM feedback remains active.' };
  }
}

function trunkLean(points: Point[], screen: Point[]) {
  if (![11, 12, 23, 24].every((index) => (screen[index]?.visibility ?? 0) >= 0.45)) return null;
  const shoulderY = (points[11].y + points[12].y) / 2;
  const hipY = (points[23].y + points[24].y) / 2;
  const shoulderZ = (points[11].z + points[12].z) / 2;
  const hipZ = (points[23].z + points[24].z) / 2;
  return Math.round((Math.atan2(Math.abs(shoulderZ - hipZ), Math.abs(shoulderY - hipY)) * 180) / Math.PI);
}

export default function LiveSession() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef<'ready' | 'descending' | 'ascending'>('ready');
  const baselineRef = useRef<number | null>(null);
  const lastBaselineUpdateRef = useRef<number | null>(null);
  const lowRef = useRef<number | null>(null);
  const startAngleRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const lastRepEndTimeRef = useRef<number | null>(null);
  const startTriggerThresholdRef = useRef(0);
  const repSamplesRef = useRef<RepSample[]>([]);
  const repNumberRef = useRef(0);
  const smoothedAngleRef = useRef<number | null>(null);
  const excursionThresholdRef = useRef(12);
  const lastFrameTimeRef = useRef(-1);
  const lastUiUpdateRef = useRef(0);
  const sessionStartTimeRef = useRef<number | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [angleNow, setAngleNow] = useState<number | null>(null);
  const [trunkNow, setTrunkNow] = useState<number | null>(null);
  const [asymmetryNow, setAsymmetryNow] = useState<number | null>(null);
  const [phase, setPhase] = useState('Camera off');
  const [tracking, setTracking] = useState('Waiting for camera');
  const [minAngle, setMinAngle] = useState('');
  const [maxAngle, setMaxAngle] = useState('');
  const [maxTrunkAngle, setMaxTrunkAngle] = useState('');
  const [maxAsymmetry, setMaxAsymmetry] = useState('');
  const [minRepMovement, setMinRepMovement] = useState(String(DETECTOR.minRepMovementDegrees));
  const [readiness, setReadiness] = useState<ExerciseReadiness>(EXERCISE.readiness);
  const [readinessReason, setReadinessReason] = useState(EXERCISE.readinessMessage);
  const [reps, setReps] = useState<Rep[]>([]);
  const [detectorLogs, setDetectorLogs] = useState<DetectorLog[]>([]);
  const [angleHistory, setAngleHistory] = useState<AngleHistoryPoint[]>([]);
  const [repMarkers, setRepMarkers] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/quality/exercises', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Quality model service is unavailable. Live movement checks are rules-based.');
        return response.json();
      })
      .then((result) => {
        if (cancelled) return;
        const exercise = result.exercises?.find((item: { exercise?: string }) => item.exercise === EXERCISE.id);
        if (exercise?.readiness) setReadiness(exercise.readiness as ExerciseReadiness);
        if (exercise?.readiness_reason) setReadinessReason(exercise.readiness_reason as string);
        else if (!exercise) {
          setReadiness('rules_only');
          setReadinessReason('No quality model is registered for this exercise; current checks are rules-based.');
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setReadiness('rules_only');
        setReadinessReason(error instanceof Error ? error.message : 'Quality model service is unavailable.');
      });
    return () => { cancelled = true; };
  }, []);

  const logDetector = useCallback((entry: DetectorLog) => {
    console.info('[Kinexa rep detector]', entry);
    setDetectorLogs((current) => [...current.slice(-7), entry]);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
    setPhase('Camera off');
    setTracking('Waiting for camera');
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    landmarkerRef.current?.close();
  }, []);

  const start = async () => {
    setError(''); setLoading(true);
    try {
      const min = minAngle === '' ? null : Number(minAngle);
      const max = maxAngle === '' ? null : Number(maxAngle);
      if ((min === null) !== (max === null)) {
        throw new Error('Enter both minimum and maximum knee angles, or leave both blank.');
      }
      if ((min !== null && (!Number.isFinite(min) || min < 30 || min > 180)) || (max !== null && (!Number.isFinite(max) || max < 30 || max > 180)) || (min !== null && max !== null && min > max)) {
        throw new Error('Enter a valid knee angle range between 30° and 180°, with minimum no greater than maximum.');
      }
      for (const [label, raw, upper] of [['maximum trunk lean', maxTrunkAngle, 90], ['maximum knee asymmetry', maxAsymmetry, 90]] as const) {
        if (raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > upper)) {
          throw new Error(`Enter a valid ${label} between 0° and ${upper}°.`);
        }
      }
      if (!Number.isFinite(Number(minRepMovement)) || Number(minRepMovement) < 8 || Number(minRepMovement) > 45) {
        throw new Error('Set minimum knee movement between 8° and 45° per rep.');
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost in a supported browser.');
      repNumberRef.current = reps.length;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview is unavailable.');
      video.srcObject = stream;
      await video.play();
      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm');
        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '/api/pose-model', delegate: 'GPU' },
          runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.55, minTrackingConfidence: 0.55,
        });
      }
      phaseRef.current = 'ready'; baselineRef.current = null; lastBaselineUpdateRef.current = null; lowRef.current = null; startAngleRef.current = null;
      startTimeRef.current = null; lastRepEndTimeRef.current = null; repSamplesRef.current = []; smoothedAngleRef.current = null; lastFrameTimeRef.current = -1;
      sessionStartTimeRef.current = performance.now(); lastUiUpdateRef.current = 0; setAngleHistory([]); setRepMarkers([]);
      setRunning(true); setPhase('Hold a comfortable starting position');
      const loop = () => {
        const v = videoRef.current; const canvas = canvasRef.current; const detector = landmarkerRef.current;
        if (!v || !canvas || !detector || v.readyState < 2) { rafRef.current = requestAnimationFrame(loop); return; }
        if (v.currentTime === lastFrameTimeRef.current) { rafRef.current = requestAnimationFrame(loop); return; }
        lastFrameTimeRef.current = v.currentTime;
        const result = detector.detectForVideo(v, performance.now());
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = v.videoWidth; canvas.height = v.videoHeight;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const points = result.worldLandmarks?.[0] as Point[] | undefined;
          const screen = result.landmarks?.[0];
          if (points && screen) {
            setTracking('Pose detected');
            ctx.strokeStyle = '#a7f3d0'; ctx.lineWidth = Math.max(2, canvas.width / 360); ctx.fillStyle = '#f5b544';
            for (const [a, b] of CONNECTIONS) {
              if ((screen[a]?.visibility ?? 0) < 0.35 || (screen[b]?.visibility ?? 0) < 0.35) continue;
              ctx.beginPath(); ctx.moveTo(screen[a].x * canvas.width, screen[a].y * canvas.height); ctx.lineTo(screen[b].x * canvas.width, screen[b].y * canvas.height); ctx.stroke();
            }
            for (const p of screen) if ((p.visibility ?? 0) > 0.35) { ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, Math.max(3, canvas.width / 240), 0, Math.PI * 2); ctx.fill(); }
            for (const [index, color] of [[25, '#167c69'], [26, '#d69b35']] as const) {
              if ((screen[index]?.visibility ?? 0) < 0.45) continue;
              ctx.fillStyle = color; ctx.beginPath(); ctx.arc(screen[index].x * canvas.width, screen[index].y * canvas.height, Math.max(5, canvas.width / 180), 0, Math.PI * 2); ctx.fill();
            }
            ctx.fillStyle = '#f5b544';
            // MediaPipe indices use the subject's anatomical left/right, even though the camera preview is mirrored.
            // Low-confidence inferred joints can make an occluded support leg appear to bend.
            // Leave that side blank in the chart and exclude it from rep validation instead.
            const leftVisible = hasReliableKnee(screen, [23, 25, 27]);
            const rightVisible = hasReliableKnee(screen, [24, 26, 28]);
            const left = leftVisible ? angle(points[23], points[25], points[27]) : null;
            const right = rightVisible ? angle(points[24], points[26], points[28]) : null;
            const leftHip = leftVisible && (screen[11]?.visibility ?? 0) >= DETECTOR.kneeLandmarkVisibility ? angle(points[11], points[23], points[25]) : null;
            const rightHip = rightVisible && (screen[12]?.visibility ?? 0) >= DETECTOR.kneeLandmarkVisibility ? angle(points[12], points[24], points[26]) : null;
            const currentTrunkLean = trunkLean(points, screen);
            const candidate = left !== null && right !== null ? (Math.min(screen[23].visibility ?? 0, screen[25].visibility ?? 0, screen[27].visibility ?? 0) >= Math.min(screen[24].visibility ?? 0, screen[26].visibility ?? 0, screen[28].visibility ?? 0) ? left : right) : left ?? right;
            if (candidate !== null) {
              const now = performance.now();
              const smoothed = smoothedAngleRef.current === null ? candidate : smoothedAngleRef.current * DETECTOR.smoothingPreviousWeight + candidate * (1 - DETECTOR.smoothingPreviousWeight);
              smoothedAngleRef.current = smoothed;
              if (now - lastUiUpdateRef.current > 150) {
                setAngleNow(Math.round(smoothed));
                setTrunkNow(currentTrunkLean);
                setAsymmetryNow(left !== null && right !== null ? Math.abs(left - right) : null);
                if (sessionStartTimeRef.current !== null) {
                  const point = { seconds: (now - sessionStartTimeRef.current) / 1000, leftKnee: left, rightKnee: right };
                  setAngleHistory((history) => [...history.filter((item) => item.seconds >= point.seconds - 30), point]);
                }
                lastUiUpdateRef.current = now;
              }
              const sample: RepSample = {
                time: now / 1000,
                leftKnee: left,
                rightKnee: right,
                leftHip,
                rightHip,
                primaryKnee: candidate,
                trunkLean: currentTrunkLean,
              };
              if (phaseRef.current === 'descending') repSamplesRef.current.push(sample);
              if (phaseRef.current === 'ready') {
                const baseline = baselineRef.current;
                if (baseline === null) baselineRef.current = smoothed;
                else {
                  // Let the standing reference follow slow stance/camera drift while the
                  // detector is idle. A frozen early peak can otherwise strand the rep
                  // state below its return threshold for the rest of the session.
                  const elapsed = lastBaselineUpdateRef.current === null
                    ? 1 / DETECTOR.defaultFrameRate
                    : Math.min(DETECTOR.maxBaselineUpdateIntervalSeconds, Math.max(0, now / 1000 - lastBaselineUpdateRef.current));
                  const maxShift = DETECTOR.baselineAdaptationDegreesPerSecond * elapsed;
                  const shift = Math.max(-maxShift, Math.min(maxShift, smoothed - baseline));
                  baselineRef.current = baseline + shift;
                }
                lastBaselineUpdateRef.current = now / 1000;
                const calibratedTop = baselineRef.current ?? candidate;
                const startThreshold = Math.max(DETECTOR.startThresholdMinDegrees, Math.min(DETECTOR.startThresholdMaxDegrees, Math.round(Number(minRepMovement) * DETECTOR.startThresholdFraction)));
                if (smoothed <= calibratedTop - startThreshold) {
                  phaseRef.current = 'descending'; lowRef.current = smoothed; startAngleRef.current = calibratedTop;
                  startTimeRef.current = now / 1000; repSamplesRef.current = [sample];
                  startTriggerThresholdRef.current = startThreshold;
                  excursionThresholdRef.current = Number(minRepMovement); setPhase('Lower with control');
                  logDetector({
                    time: new Date().toLocaleTimeString(), event: 'started', angle: Math.round(smoothed),
                    baseline: Math.round(calibratedTop), bottom: null, excursion: 0, triggerThreshold: startThreshold,
                    leftExcursion: null, rightExcursion: null,
                    leftVisibleFrames: null, rightVisibleFrames: null, repFrames: null,
                    bottomAsymmetry: null,
                    minBilateralMovement: Math.max(10, Math.round(Number(minRepMovement) * 0.5)),
                    bilateralRatio: null,
                    minMovement: Number(minRepMovement), duration: 0, minDuration: DETECTOR.minimumRepDurationSeconds,
                    gap: lastRepEndTimeRef.current === null ? null : Number((now / 1000 - lastRepEndTimeRef.current).toFixed(2)),
                    minGap: DETECTOR.minimumRepGapSeconds,
                  });
                }
              } else if (phaseRef.current === 'descending') {
                lowRef.current = Math.min(lowRef.current ?? smoothed, smoothed);
                const repBottom = lowRef.current ?? smoothed;
                const repTop = startAngleRef.current ?? smoothed;
                const repExcursion = repTop - repBottom;
                const returnOffset = Math.min(DETECTOR.maxStandingReturnOffsetDegrees, Math.max(DETECTOR.returnOffsetFloorDegrees, Math.round(excursionThresholdRef.current * 0.9)));
                // Require recovery near standing, but tolerate a modest shift from the
                // calibrated top. The bottom-relative guard prevents a tiny rebound from
                // ending a rep before the person has substantially risen.
                const returnLevel = Math.max(
                  repTop - returnOffset,
                  repBottom + Math.max(DETECTOR.minimumRiseFromBottomDegrees, repExcursion * DETECTOR.returnFromBottomFraction),
                );
                if (smoothed >= returnLevel) {
                  const bottom = lowRef.current ?? smoothed;
                  const baseline = startAngleRef.current ?? smoothed;
                  const excursion = baseline - bottom;
                  const repSamples = repSamplesRef.current;
                  const earlyWindow = repSamples.slice(0, Math.max(DETECTOR.minimumEarlyWindowFrames, Math.ceil(repSamples.length * DETECTOR.earlyWindowFraction)));
                  const leftEarly = earlyWindow.flatMap((current) => current.leftKnee === null ? [] : [current.leftKnee]);
                  const rightEarly = earlyWindow.flatMap((current) => current.rightKnee === null ? [] : [current.rightKnee]);
                  const leftValues = repSamples.flatMap((current) => current.leftKnee === null ? [] : [current.leftKnee]);
                  const rightValues = repSamples.flatMap((current) => current.rightKnee === null ? [] : [current.rightKnee]);
                  const leftVisibleFrames = leftValues.length;
                  const rightVisibleFrames = rightValues.length;
                  const minStartFrames = Math.min(DETECTOR.minimumEarlyWindowFrames, Math.max(1, Math.ceil(earlyWindow.length * DETECTOR.minimumStartVisibleFraction)));
                  const leftExcursion = leftEarly.length >= minStartFrames && leftValues.length >= DETECTOR.minimumSideVisibleFrames
                    ? Number((Math.max(...leftEarly) - Math.min(...leftValues)).toFixed(1))
                    : null;
                  const rightExcursion = rightEarly.length >= minStartFrames && rightValues.length >= DETECTOR.minimumSideVisibleFrames
                    ? Number((Math.max(...rightEarly) - Math.min(...rightValues)).toFixed(1))
                    : null;
                  const pairedSamples = repSamples.filter((current) => current.leftKnee !== null && current.rightKnee !== null);
                  const deepestBilateralSample = pairedSamples.reduce<RepSample | null>((deepest, current) => {
                    if (deepest === null) return current;
                    const currentMean = ((current.leftKnee as number) + (current.rightKnee as number)) / 2;
                    const deepestMean = ((deepest.leftKnee as number) + (deepest.rightKnee as number)) / 2;
                    return currentMean < deepestMean ? current : deepest;
                  }, null);
                  const bottomAsymmetry = pairedSamples.length < DETECTOR.minimumPairedFrames || deepestBilateralSample === null
                    ? null
                    : Number(Math.abs((deepestBilateralSample.leftKnee as number) - (deepestBilateralSample.rightKnee as number)).toFixed(1));
                  const bilateralRatio = leftExcursion !== null && rightExcursion !== null
                    ? Number((Math.min(leftExcursion, rightExcursion) / Math.max(leftExcursion, rightExcursion, 1)).toFixed(2))
                    : null;
                  const minBilateralMovement = Math.max(DETECTOR.minimumBilateralMovementDegrees, Math.round(excursionThresholdRef.current * DETECTOR.minimumBilateralMovementFraction));
                  const duration = Math.max(0, now / 1000 - (startTimeRef.current ?? now / 1000));
                  const gap = lastRepEndTimeRef.current === null ? null : now / 1000 - lastRepEndTimeRef.current;
                  const rejectionReasons: string[] = [];
                  if (excursion < excursionThresholdRef.current) rejectionReasons.push(`movement ${excursion.toFixed(1)}° was below ${excursionThresholdRef.current}° minimum`);
                  if (leftExcursion === null || rightExcursion === null) rejectionReasons.push(`bilateral knee travel could not be confirmed (left visible ${leftVisibleFrames}/${repSamples.length} rep frames, right ${rightVisibleFrames}/${repSamples.length}); keep both knees and ankles in view`);
                  else if (leftExcursion < minBilateralMovement || rightExcursion < minBilateralMovement) rejectionReasons.push(`both knees must move at least ${minBilateralMovement}° (left ${leftExcursion}°, right ${rightExcursion}°)`);
                  else if (bilateralRatio !== null && bilateralRatio < DETECTOR.minimumBilateralTravelRatio) rejectionReasons.push(`knee travel was too one-sided (left ${leftExcursion}°, right ${rightExcursion}°; weaker side ${Math.round(bilateralRatio * 100)}% of stronger side, minimum ${Math.round(DETECTOR.minimumBilateralTravelRatio * 100)}%)`);
                  if (bottomAsymmetry === null) rejectionReasons.push('bottom knee symmetry could not be confirmed; keep both knees visible throughout the movement');
                  else if (bottomAsymmetry > DETECTOR.maximumCountedKneeAsymmetryDegrees) rejectionReasons.push(`bottom knee angles differed by ${bottomAsymmetry}°, above the ${DETECTOR.maximumCountedKneeAsymmetryDegrees}° rep-count limit; this looks like one-sided movement`);
                  if (duration < DETECTOR.minimumRepDurationSeconds) rejectionReasons.push(`rep duration ${duration.toFixed(2)}s was below ${DETECTOR.minimumRepDurationSeconds}s minimum`);
                  if (gap !== null && gap < DETECTOR.minimumRepGapSeconds) rejectionReasons.push(`rep gap ${gap.toFixed(2)}s was below ${DETECTOR.minimumRepGapSeconds}s minimum`);
                  const event = rejectionReasons.length ? 'rejected' : 'counted';
                  logDetector({
                    time: new Date().toLocaleTimeString(), event, angle: Math.round(smoothed),
                    baseline: Math.round(baseline), bottom: Math.round(bottom), excursion: Number(excursion.toFixed(1)),
                    leftExcursion, rightExcursion, leftVisibleFrames, rightVisibleFrames, repFrames: repSamples.length,
                    bottomAsymmetry,
                    minBilateralMovement, bilateralRatio,
                    triggerThreshold: startTriggerThresholdRef.current, minMovement: excursionThresholdRef.current,
                    duration: Number(duration.toFixed(2)), minDuration: DETECTOR.minimumRepDurationSeconds,
                    gap: gap === null ? null : Number(gap.toFixed(2)), minGap: DETECTOR.minimumRepGapSeconds,
                    reason: rejectionReasons.length ? rejectionReasons.join('; ') : 'movement, duration, and spacing thresholds met',
                  });
                  if (event === 'counted') {
                    lastRepEndTimeRef.current = now / 1000;
                    if (sessionStartTimeRef.current !== null) {
                      const repMarker = (now - sessionStartTimeRef.current) / 1000;
                      setRepMarkers((markers) => [...markers.filter((time) => time >= repMarker - 30), repMarker]);
                    }
                    const samples = repSamplesRef.current;
                    const deepest = samples.reduce((lowest, current) => current.primaryKnee < lowest.primaryKnee ? current : lowest, sample);
                    const asymmetry = deepest.leftKnee !== null && deepest.rightKnee !== null ? Math.abs(deepest.leftKnee - deepest.rightKnee) : null;
                    const peakTrunkLean = samples.reduce((peak, current) => current.trunkLean === null ? peak : Math.max(peak ?? 0, current.trunkLean), null as number | null);
                    const kneeConfigured = minAngle !== '' && maxAngle !== '';
                    const kneeOutside = kneeConfigured && (bottom < Number(minAngle) || bottom > Number(maxAngle));
                    const trunkOutside = maxTrunkAngle !== '' && peakTrunkLean !== null && peakTrunkLean > Number(maxTrunkAngle);
                    const asymmetryOutside = maxAsymmetry !== '' && asymmetry !== null && asymmetry > Number(maxAsymmetry);
                    const configuredMetricMissing = (maxTrunkAngle !== '' && peakTrunkLean === null) || (maxAsymmetry !== '' && asymmetry === null);
                    const hasAnyLimit = kneeConfigured || maxTrunkAngle !== '' || maxAsymmetry !== '';
                    const verdict: Rep['verdict'] = kneeOutside || trunkOutside || asymmetryOutside
                      ? 'outside range'
                      : configuredMetricMissing
                        ? 'not assessable'
                        : hasAnyLimit
                          ? 'within range'
                          : 'range not set';
                    const cues: string[] = [];
                    if (kneeOutside) cues.push(bottom < Number(minAngle) ? 'You moved beyond the prescribed depth; reduce squat depth.' : 'Reach the prescribed depth, if comfortable.');
                    else if (kneeConfigured) cues.push('Knee depth is within the prescribed range.');
                    if (trunkOutside) cues.push(`Trunk lean reached ${peakTrunkLean}°, above the therapist-set ${maxTrunkAngle}° limit.`);
                    else if (maxTrunkAngle !== '' && peakTrunkLean === null) cues.push('Trunk lean could not be assessed because shoulder or hip landmarks were not visible enough.');
                    if (asymmetryOutside && asymmetry !== null) cues.push(`Knee angles differed by ${asymmetry}°, above the therapist-set ${maxAsymmetry}° limit.`);
                    else if (maxAsymmetry !== '' && asymmetry === null) cues.push('Knee asymmetry could not be assessed because both knees were not visible enough.');
                    if (!hasAnyLimit) cues.push('Set at least one therapist-prescribed limit to assess this rep.');
                    const number = ++repNumberRef.current;
                    const modelFeatures = makeSquatModelFeatures(samples);
                    setReps((old) => [...old, {
                      number, angle: Math.round(bottom), asymmetry, maxTrunkLean: peakTrunkLean, duration,
                      verdict, cue: cues.join(' '), model: { status: 'checking' },
                    }]);
                    void requestExerciseModel(EXERCISE.id, modelFeatures).then((model) => {
                      setReps((old) => old.map((rep) => rep.number === number ? { ...rep, model } : rep));
                    });
                  } else setPhase('Rep not counted · see detector log');
                  phaseRef.current = 'ready'; lowRef.current = null; startAngleRef.current = null;
                  startTimeRef.current = null; repSamplesRef.current = []; setPhase('Return to a comfortable start');
                }
                else if (smoothed > (lowRef.current ?? smoothed) + 5) setPhase('Rise with control');
              }
            }
            else { setTracking('Pose detected · improve knee and ankle visibility'); setAngleNow(null); setTrunkNow(null); setAsymmetryNow(null); }
          } else { setTracking('No pose — step back into view'); setAngleNow(null); setTrunkNow(null); setAsymmetryNow(null); }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
      setError(err instanceof Error ? err.message : 'Could not start live pose tracking. Check camera permissions and model availability.');
      setRunning(false);
    } finally { setLoading(false); }
  };

  const latest = reps.at(-1);
  return (
    <main className="app-shell">
      <header className="topbar"><a className="brand" href="#">KINEXA<span>MOVE BETTER, WITH GUIDANCE</span></a><div className="live-indicator"><i className={running ? 'pulse on' : 'pulse'} />{running ? 'LIVE SESSION' : 'SESSION READY'}</div></header>
      <section className="intro"><div><p className="eyebrow">REHABILITATION · {EXERCISE.label.toUpperCase()} PRACTICE</p><h1>Your movement,<br/><em>in the moment.</em></h1><p className="lede">Real-time pose guidance with a range set for your recovery.</p></div><div className="session-meta"><span>01 / LIVE COACH</span><span>Side view recommended</span><span>{readiness === 'camera_validated' ? 'CAMERA VALIDATED' : readiness === 'model_advisory' ? 'MODEL ADVISORY' : 'RULES ONLY'}</span><small>{readinessReason}</small></div></section>
      <section className="workspace">
        <div className="camera-column">
          <div className="camera-frame"><video ref={videoRef} muted playsInline/><canvas ref={canvasRef} className="pose-canvas"/>{!running && <div className="camera-placeholder"><div className="camera-mark">◎</div><b>Set up your camera</b><span>Position the camera at hip height, far enough away to show your full body.</span></div>}<div className="camera-badge"><i className={running ? 'pulse on' : 'pulse'}/>{running ? tracking : 'CAMERA PREVIEW'}</div>{angleNow !== null && <div className="angle-overlay"><span>KNEE ANGLE</span><b>{angleNow}°</b></div>}</div>
          <div className="camera-actions"><div><span className="micro-label">CAMERA POSITION</span><b>Side-on · Full body in frame</b></div><button className={running ? 'button button-stop' : 'button'} onClick={running ? stop : start} disabled={loading}>{loading ? 'Preparing camera…' : running ? 'End session' : 'Start live session'}<span aria-hidden="true">{running ? '×' : '↗'}</span></button></div>
          {error && <p className="error-banner" role="alert">{error}</p>}
          <div className="safety-note"><span>i</span><p>Keep a stable chair or support nearby. Stop if you feel pain, dizziness, or unusual discomfort.</p></div>
        </div>
        <aside className="coach-column">
          <div className="panel-heading"><div><p className="eyebrow">YOUR SESSION</p><h2>Live coach</h2></div><span className="rep-count"><b>{reps.length.toString().padStart(2, '0')}</b><small>REPS</small></span></div>
          <div className="phase-card"><span className="micro-label">MOVEMENT CUE</span><strong>{running ? phase : 'Ready when you are'}</strong><p>{latest?.cue ?? (running ? 'Move at a comfortable pace. Feedback appears after each completed rep.' : 'Start the camera to see your pose and movement cues.')}</p></div>
          <div className="metric-row">
            <div><span className="micro-label">KNEE ANGLE</span><b>{angleNow === null ? '—' : `${angleNow}°`}</b></div>
            <div><span className="micro-label">TRUNK LEAN</span><b>{trunkNow === null ? '—' : `${trunkNow}°`}</b></div>
            <div><span className="micro-label">ASYMMETRY</span><b>{asymmetryNow === null ? '—' : `${asymmetryNow}°`}</b></div>
          </div>
          <section className="angle-chart-panel" aria-label="Knee angle over time">
            <div className="angle-chart-header"><span className="micro-label">KNEE ANGLE · LAST 30 SECONDS</span><div className="angle-chart-legend"><span><i className="legend-left"/>Your left knee</span><span><i className="legend-right"/>Your right knee</span>{minAngle !== '' && maxAngle !== '' && <span><i className="legend-range"/>Prescribed range</span>}<span><i className="legend-rep"/>Counted rep</span></div></div>
            <p className="angle-chart-note">Left and right refer to your body; the camera preview is mirrored. A knee trace is omitted when its hip, knee, or ankle is not clearly visible.</p>
            {angleHistory.length > 1 ? <div className="angle-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={angleHistory} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#e8ece7" strokeDasharray="3 4" vertical={false}/>
              <XAxis dataKey="seconds" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => `${value.toFixed(0)}s`} tick={{ fill: '#87928d', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#e3e8e2' }} minTickGap={24}/>
              <YAxis type="number" domain={[30, 180]} ticks={[60, 90, 120, 150, 180]} tickFormatter={(value: number) => `${value}°`} tick={{ fill: '#87928d', fontSize: 9 }} tickLine={false} axisLine={false} width={42}/>
              <Tooltip labelFormatter={(value: number) => `${Number(value).toFixed(1)} seconds`} formatter={(value: number, name: string) => [`${value}°`, name]} contentStyle={{ border: '1px solid #e3e8e2', borderRadius: 2, fontSize: 10 }}/>
              {minAngle !== '' && maxAngle !== '' && <ReferenceArea y1={Number(minAngle)} y2={Number(maxAngle)} fill="#79d69d" fillOpacity={0.16} strokeOpacity={0}/>}
              {repMarkers.map((time, index) => <ReferenceLine key={`rep-${index}-${time.toFixed(2)}`} x={time} stroke="#81918a" strokeDasharray="3 4" strokeWidth={1}/>) }
              <Line type="monotone" dataKey="leftKnee" name="Your left knee" stroke="#167c69" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/>
              <Line type="monotone" dataKey="rightKnee" name="Your right knee" stroke="#d69b35" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/>
            </LineChart></ResponsiveContainer></div> : <p className="angle-chart-empty">Start the camera to see both knee angles move through the session.</p>}
          </section>
          <div className="rom-panel">
            <div className="rom-title"><div><p className="eyebrow">PERSONAL RANGE</p><h3>Therapist-set ROM</h3></div><span className="lock-tag">LOCAL</span></div>
            <p className="rom-copy">Set the prescribed knee angle range at the bottom of each rep. Optional limits can assess trunk lean and knee asymmetry. Only the limits entered here are evaluated.</p>
            <div className="range-inputs">
              <label>Minimum knee angle <span><input type="number" min="30" max="180" placeholder="e.g. 80" value={minAngle} disabled={running} onChange={(e) => setMinAngle(e.target.value)}/>°</span></label>
              <label>Maximum knee angle <span><input type="number" min="30" max="180" placeholder="e.g. 110" value={maxAngle} disabled={running} onChange={(e) => setMaxAngle(e.target.value)}/>°</span></label>
              <label>Maximum trunk lean <span><input type="number" min="0" max="90" placeholder="optional" value={maxTrunkAngle} disabled={running} onChange={(e) => setMaxTrunkAngle(e.target.value)}/>°</span></label>
              <label>Maximum asymmetry <span><input type="number" min="0" max="90" placeholder="optional" value={maxAsymmetry} disabled={running} onChange={(e) => setMaxAsymmetry(e.target.value)}/>°</span></label>
              <label>Minimum knee movement <span><input type="number" min={DETECTOR.minimumUserMovementDegrees} max={DETECTOR.maximumUserMovementDegrees} value={minRepMovement} disabled={running} onChange={(e) => setMinRepMovement(e.target.value)}/>°</span></label>
            </div>
            <p className="local-hint">Minimum knee movement (default 20°) is a rep-detection threshold, separate from prescribed ROM. These settings stay in this browser for now; patient plans are not connected yet.</p>
          </div>
          <div className="rep-list"><div className="list-head"><h3>Recent reps</h3><span>{reps.length ? `${reps.length} recorded` : 'No reps yet'}</span></div>{latest ? <div className="rep-item"><span className="rep-number">{String(latest.number).padStart(2, '0')}</span><div><b>Bottom knee · {latest.angle}°{latest.maxTrunkLean === null ? '' : ` · trunk ${latest.maxTrunkLean}°`}{latest.asymmetry === null ? '' : ` · asymmetry ${latest.asymmetry}°`}</b><small>{latest.duration.toFixed(1)} s · {latest.cue}</small><small className="model-note">{latest.model.status === 'checking' ? 'Checking general-form model…' : latest.model.status === 'available' ? `Research model advisory: ${latest.model.task === 'regression' ? `predicted score ${latest.model.prediction}` : latest.model.prediction === 'incorrect' ? 'possible form concern' : latest.model.prediction === 'correct' ? 'no general form concern' : `prediction ${latest.model.prediction ?? 'unavailable'}`}${latest.model.confidence === undefined ? '' : ` · ${(latest.model.confidence * 100).toFixed(0)}% confidence`} · therapist ROM rules take precedence; camera validation pending.` : `Model advisory unavailable: ${latest.model.reason ?? 'insufficient visible data'}`}</small></div><span className={`verdict ${latest.verdict === 'within range' ? 'pass' : latest.verdict === 'not assessable' ? 'unassessable' : 'pending'}`}>{latest.verdict === 'within range' ? 'LIMITS OK' : latest.verdict === 'range not set' ? 'SET ROM' : latest.verdict === 'not assessable' ? 'NOT ASSESSABLE' : 'REVIEW'}</span></div> : <p className="empty-reps">Your completed reps and cues will appear here.</p>}</div>
          <details className="detector-log">
            <summary>Rep detector log · {detectorLogs.length} recent events</summary>
            <p>Each event shows knee travel on both sides, bottom-position angle difference, visibility, duration, and spacing. A rep needs at least {DETECTOR.minimumBilateralMovementDegrees}° travel in each knee and no more than {DETECTOR.maximumCountedKneeAsymmetryDegrees}° difference at the bottom. The same structured entries are written to the browser console as <code>[Kinexa rep detector]</code>.</p>
            {detectorLogs.length ? <ol>{[...detectorLogs].reverse().map((entry, index) => <li key={`${entry.time}-${entry.event}-${index}`}><b>{entry.event.toUpperCase()}</b><span>{entry.time} · angle {entry.angle}° · top {entry.baseline}°{entry.bottom === null ? '' : ` · bottom ${entry.bottom}°`} · travel {entry.excursion}° / {entry.minMovement}° minimum · left {entry.leftExcursion === null ? '—' : `${entry.leftExcursion}°`} · right {entry.rightExcursion === null ? '—' : `${entry.rightExcursion}°`} / {entry.minBilateralMovement}° each minimum · bottom difference {entry.bottomAsymmetry === null ? '—' : `${entry.bottomAsymmetry}°`} / {DETECTOR.maximumCountedKneeAsymmetryDegrees}° maximum · visible L/R {entry.leftVisibleFrames ?? '—'}/{entry.repFrames ?? '—'} · {entry.rightVisibleFrames ?? '—'}/{entry.repFrames ?? '—'} frames · balance {entry.bilateralRatio === null ? '—' : `${Math.round(entry.bilateralRatio * 100)}%`} / {Math.round(DETECTOR.minimumBilateralTravelRatio * 100)}% minimum · duration {entry.duration}s / {entry.minDuration}s minimum{entry.gap === null ? '' : ` · gap ${entry.gap}s / ${entry.minGap}s minimum`}</span>{entry.reason && <small>{entry.reason}</small>}</li>)}</ol> : <small>No movement events logged yet. Start the camera and move through one cycle.</small>}
          </details>
        </aside>
      </section>
      <footer className="disclaimer"><span>FOR GUIDANCE ONLY</span><p>Kinexa is a movement feedback prototype, not a medical device. Angle estimates can be affected by camera position and visibility. Follow your physiotherapist’s advice.</p><span>V0.2 · LIVE</span></footer>
    </main>
  );
}
