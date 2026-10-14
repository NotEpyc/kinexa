'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getLiveExercise, LIVE_EXERCISES } from '@/lib/exercises';
import type { ExerciseReadiness } from '@/lib/exercises';
import type { KneeAngleSample } from '@/lib/exercises/bilateral-knee-strategy';

type Point = { x: number; y: number; z: number; visibility?: number };
type Rep = {
  number: number;
  angle: number;
  primaryLabel: string;
  asymmetry: number | null;
  maxTrunkLean: number | null;
  duration: number;
  verdict: 'within range' | 'outside range' | 'range not set' | 'not assessable';
  cue: string;
  measurements: Array<{ metric: string; side: string; phase: string; value: number; unit: string }>;
  advice: Array<{ code: string; source: string; message: string }>;
  start_s: number;
  bottom_s: number;
  end_s: number;
  model: { status: 'checking' | 'available' | 'unavailable' | 'skipped'; prediction?: string | number; task?: string; confidence?: number; version?: string; reason?: string };
};
type RepSample = KneeAngleSample;
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

type KneeAngleConvention = 'joint_angle' | 'flexion';

function toKinexaKneeRange(minimum: number, maximum: number, convention: KneeAngleConvention) {
  return convention === 'flexion'
    ? { min: 180 - maximum, max: 180 - minimum }
    : { min: minimum, max: maximum };
}

function describeModelAssessment(model: Rep['model']) {
  if (model.status === 'checking') return 'Checking general-form model…';
  if (model.status === 'skipped') return model.reason ?? 'Model skipped for this rep.';
  if (model.status === 'unavailable') return `Model advisory unavailable: ${model.reason ?? 'insufficient visible data'}`;
  const prediction = model.task === 'regression'
    ? `predicted score ${model.prediction}`
    : model.prediction === 'incorrect'
      ? 'possible general-form concern'
      : model.prediction === 'correct'
        ? 'no general-form concern'
        : `prediction ${model.prediction ?? 'unavailable'}`;
  return `Research model advisory: ${prediction}${model.confidence === undefined ? '' : ` · ${(model.confidence * 100).toFixed(0)}% confidence`} · not clinically validated.`;
}

const CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32], [27, 29], [29, 31], [28, 30], [30, 32],
];

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

async function requestPatientAdvice(exercise: string, patientId: string, measurements: Rep['measurements']) {
  const response = await fetch('/api/backend/quality/coach', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exercise, patient_id: patientId, measurements }), cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || 'Could not load patient-specific advice.');
  return result as { personalized: boolean; plan_id: string | null; advice: Rep['advice']; message?: string };
}

export default function LiveSession() {
  const [exerciseId, setExerciseId] = useState('squat');
  const EXERCISE = getLiveExercise(exerciseId);
  const DETECTOR = EXERCISE.detector;
  const TARGET_PHASE = EXERCISE.descentDirection === 'decrease' ? 'at_bottom' : 'at_peak';
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
  const [kneeAngleConvention, setKneeAngleConvention] = useState<KneeAngleConvention>('joint_angle');
  const [maxTrunkAngle, setMaxTrunkAngle] = useState('');
  const [maxAsymmetry, setMaxAsymmetry] = useState('');
  const [minRepMovement, setMinRepMovement] = useState(String(DETECTOR.minRepMovementDegrees));
  const [readiness, setReadiness] = useState<ExerciseReadiness>(EXERCISE.readiness);
  const [readinessReason, setReadinessReason] = useState(EXERCISE.readinessMessage);
  const [reps, setReps] = useState<Rep[]>([]);
  const [patientId, setPatientId] = useState('');
  const [therapistId, setTherapistId] = useState('');
  const [newPatientName, setNewPatientName] = useState('');
  const [databaseMessage, setDatabaseMessage] = useState('');
  const [savingSession, setSavingSession] = useState(false);
  const [savedPlanLoaded, setSavedPlanLoaded] = useState(false);
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
        if (EXERCISE.readiness === 'rules_only') {
          setReadiness('rules_only');
          setReadinessReason(EXERCISE.readinessMessage);
        } else if (exercise?.readiness) setReadiness(exercise.readiness as ExerciseReadiness);
        if (EXERCISE.readiness !== 'rules_only' && exercise?.readiness_reason) setReadinessReason(exercise.readiness_reason as string);
        else if (!exercise && EXERCISE.readiness !== 'rules_only') {
          setReadiness('rules_only');
          setReadinessReason('No quality model is registered for this exercise; current checks are rules-based.');
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setReadiness('rules_only');
        if (EXERCISE.readiness !== 'rules_only') setReadinessReason(error instanceof Error ? error.message : 'Quality model service is unavailable.');
      });
    return () => { cancelled = true; };
  }, [exerciseId, EXERCISE.id]);

  useEffect(() => {
    setReps([]);
    setDetectorLogs([]);
    setAngleHistory([]);
    setRepMarkers([]);
    setAngleNow(null);
    setTrunkNow(null);
    setAsymmetryNow(null);
    setPhase('Hold a comfortable starting position');
    setReadiness(EXERCISE.readiness);
    setReadinessReason(EXERCISE.readinessMessage);
    setSavedPlanLoaded(false);
    setMinAngle('');
    setMaxAngle('');
    setMaxTrunkAngle('');
    setMaxAsymmetry('');
    setMinRepMovement(String(getLiveExercise(exerciseId).detector.minRepMovementDegrees));
    repNumberRef.current = 0;
  }, [exerciseId, EXERCISE.readiness, EXERCISE.readinessMessage]);

  const logDetector = useCallback((entry: DetectorLog) => {
    console.info('[Kinexa rep detector]', entry);
    setDetectorLogs((current) => [...current.slice(-7), entry]);
  }, []);

  const loadPatientPlan = async () => {
    if (!patientId.trim()) { setDatabaseMessage('Enter a patient ID first.'); return; }
    setSavedPlanLoaded(false);
    setMinAngle(''); setMaxAngle(''); setMaxTrunkAngle(''); setMaxAsymmetry('');
    setDatabaseMessage('Loading saved therapist plan…');
    try {
      const response = await fetch(`/api/backend/patients/${encodeURIComponent(patientId.trim())}/plans`, { cache: 'no-store' });
      const plans = await response.json();
      if (!response.ok) throw new Error(plans.detail || 'Could not load patient plans.');
      const plan = plans.find((item: { exercise: string; active: boolean }) => item.exercise === EXERCISE.id && item.active);
      if (!plan) { setSavedPlanLoaded(false); setDatabaseMessage(`No active ${EXERCISE.label} plan for this patient. Set the range and save it as a plan.`); return; }
      const paramsResponse = await fetch(`/api/backend/patients/${encodeURIComponent(patientId.trim())}/plans/${plan.id}/parameters`, { cache: 'no-store' });
      const parameters = await paramsResponse.json();
      if (!paramsResponse.ok) throw new Error(parameters.detail || 'Could not load plan limits.');
      const current = parameters.filter((item: { effective_to: string | null }) => !item.effective_to);
      const knee = current.filter((item: { metric: string; side: string; phase: string }) => item.metric === 'knee_angle' && item.side === 'either' && item.phase === TARGET_PHASE);
      const lower = knee.find((item: { min_value: number | null }) => item.min_value !== null)?.min_value;
      const upper = knee.find((item: { max_value: number | null }) => item.max_value !== null)?.max_value;
      if (lower !== undefined || upper !== undefined) {
        setMinAngle(String(kneeAngleConvention === 'flexion' ? 180 - (upper ?? 180) : (lower ?? 0)));
        setMaxAngle(String(kneeAngleConvention === 'flexion' ? 180 - (lower ?? 0) : (upper ?? 180)));
      }
      const trunk = current.find((item: { metric: string; max_value: number | null }) => item.metric === 'trunk_lean' && item.max_value !== null);
      const asym = current.find((item: { metric: string; max_value: number | null }) => item.metric === 'asymmetry' && item.max_value !== null);
      if (trunk) setMaxTrunkAngle(String(trunk.max_value));
      if (asym) setMaxAsymmetry(String(asym.max_value));
      setSavedPlanLoaded(true);
      setDatabaseMessage(`Loaded saved plan for ${EXERCISE.label}. Personalized cues use its active therapist limits.`);
    } catch (error) { setDatabaseMessage(error instanceof Error ? error.message : 'Could not load patient plan.'); }
  };

  const createPatient = async () => {
    if (!therapistId.trim() || !newPatientName.trim()) { setDatabaseMessage('Enter a therapist ID and patient name to create a patient record.'); return; }
    try {
      const response = await fetch('/api/backend/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ therapist_id: therapistId.trim(), name: newPatientName.trim() }) });
      const patient = await response.json();
      if (!response.ok) throw new Error(patient.detail || 'Could not create patient.');
      setPatientId(patient.id);
      setSavedPlanLoaded(false);
      setDatabaseMessage(`Patient saved. Their ID is ${patient.id}; you can now save a therapist plan.`);
    } catch (error) { setDatabaseMessage(error instanceof Error ? error.message : 'Could not create patient.'); }
  };

  const savePatientPlan = async () => {
    if (!patientId.trim()) { setDatabaseMessage('Enter an existing patient ID first.'); return; }
    if ((minAngle === '') !== (maxAngle === '')) { setDatabaseMessage('Enter both knee limits before saving the plan.'); return; }
    setDatabaseMessage('Saving therapist plan…');
    try {
      const base = `/api/backend/patients/${encodeURIComponent(patientId.trim())}/plans`;
      const planResponse = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patient_id: patientId.trim(), exercise: EXERCISE.id, active: true }) });
      const plan = await planResponse.json();
      if (!planResponse.ok) throw new Error(plan.detail || 'Could not create the exercise plan.');
      const effective_from = new Date().toISOString();
      const params: Array<Record<string, unknown>> = [];
      const knee = minAngle !== '' ? toKinexaKneeRange(Number(minAngle), Number(maxAngle), kneeAngleConvention) : null;
      if (knee) params.push({ metric: 'knee_angle', side: 'either', phase: TARGET_PHASE, min_value: knee.min, max_value: knee.max, unit: 'deg', tolerance: 0, effective_from, version: 1 });
      if (maxTrunkAngle !== '') params.push({ metric: 'trunk_lean', side: 'either', phase: 'at_peak', max_value: Number(maxTrunkAngle), unit: 'deg', tolerance: 0, effective_from, version: 1 });
      if (maxAsymmetry !== '') params.push({ metric: 'asymmetry', side: 'either', phase: 'at_bottom', max_value: Number(maxAsymmetry), unit: 'deg', tolerance: 0, effective_from, version: 1 });
      for (const parameter of params) {
        const saved = await fetch(`${base}/${plan.id}/parameters`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_id: plan.id, ...parameter }) });
        if (!saved.ok) { const detail = await saved.json(); throw new Error(detail.detail || 'Could not save a therapist limit.'); }
      }
      setDatabaseMessage(`Saved ${params.length} therapist limit${params.length === 1 ? '' : 's'} to plan ${plan.id}.`);
      setSavedPlanLoaded(true);
    } catch (error) { setDatabaseMessage(error instanceof Error ? error.message : 'Could not save therapist plan.'); }
  };

  const saveLiveSession = async () => {
    if (!patientId.trim() || !reps.length) return;
    setSavingSession(true); setDatabaseMessage('Saving live session…');
    try {
      const correct = reps.filter((rep) => rep.verdict === 'within range').length;
      const payload = {
        patient_id: patientId.trim(), exercise: EXERCISE.id, model_version: reps.find((rep) => rep.model.version)?.model.version ?? `${EXERCISE.id}_browser_rules_v1`,
        score: Math.round(correct / reps.length * 100), total_reps: reps.length, correct_reps: correct,
        incorrect_reps: reps.filter((rep) => rep.verdict === 'outside range').length,
        constraints_snapshot: { knee_range: prescribedKneeRange, max_trunk_lean: maxTrunkAngle === '' ? null : Number(maxTrunkAngle), max_asymmetry: maxAsymmetry === '' ? null : Number(maxAsymmetry) },
        reps: reps.map((rep) => ({ rep: rep.number, status: rep.verdict === 'within range' ? 'correct' : rep.verdict === 'outside range' ? 'incorrect' : 'not_assessable', start_s: rep.start_s, bottom_s: rep.bottom_s, end_s: rep.end_s, measurements: Object.fromEntries(rep.measurements.map((item) => [`${item.metric}_${item.side}_${item.phase}`, { value: item.value, unit: item.unit }])), ml: rep.model, advice: rep.advice, issues: rep.advice })),
      };
      const response = await fetch('/api/backend/live-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Could not save live session.');
      setDatabaseMessage(`Session saved (${result.analysis_id}); ${result.saved_reps} reps stored.`);
    } catch (error) { setDatabaseMessage(error instanceof Error ? error.message : 'Could not save live session.'); }
    finally { setSavingSession(false); }
  };

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
      const minimumAllowed = kneeAngleConvention === 'flexion' ? 0 : 30;
      const maximumAllowed = kneeAngleConvention === 'flexion' ? 150 : 180;
      if ((min === null) !== (max === null)) {
        throw new Error('Enter both minimum and maximum knee angles, or leave both blank.');
      }
      if ((min !== null && (!Number.isFinite(min) || min < minimumAllowed || min > maximumAllowed)) || (max !== null && (!Number.isFinite(max) || max < minimumAllowed || max > maximumAllowed)) || (min !== null && max !== null && min > max)) {
        throw new Error(`Enter a valid ${kneeAngleConvention === 'flexion' ? 'flexion' : 'knee joint angle'} range between ${minimumAllowed}° and ${maximumAllowed}°, with minimum no greater than maximum.`);
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
            const now = performance.now();
            const sample = EXERCISE.strategy.samplePose(points, screen, now / 1000, DETECTOR.kneeLandmarkVisibility) as RepSample | null;
            if (sample !== null) {
              const { leftKnee: left, rightKnee: right, leftHip, rightHip, primaryKnee: candidate, trunkLean: currentTrunkLean } = sample;
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
                const descending = EXERCISE.descentDirection === 'decrease'
                  ? smoothed <= calibratedTop - startThreshold
                  : smoothed >= calibratedTop + startThreshold;
                if (descending) {
                  phaseRef.current = 'descending'; lowRef.current = smoothed; startAngleRef.current = calibratedTop;
                  startTimeRef.current = now / 1000; repSamplesRef.current = [sample];
                  startTriggerThresholdRef.current = startThreshold;
                  excursionThresholdRef.current = Number(minRepMovement); setPhase(EXERCISE.descentDirection === 'decrease' ? 'Lower with control' : 'Move into the exercise phase');
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
                lowRef.current = EXERCISE.descentDirection === 'decrease'
                  ? Math.min(lowRef.current ?? smoothed, smoothed)
                  : Math.max(lowRef.current ?? smoothed, smoothed);
                const repBottom = lowRef.current ?? smoothed;
                const repTop = startAngleRef.current ?? smoothed;
                const repExcursion = EXERCISE.descentDirection === 'decrease' ? repTop - repBottom : repBottom - repTop;
                const returnOffset = Math.min(DETECTOR.maxStandingReturnOffsetDegrees, Math.max(DETECTOR.returnOffsetFloorDegrees, Math.round(excursionThresholdRef.current * 0.9)));
                // Require recovery near standing, but tolerate a modest shift from the
                // calibrated top. The bottom-relative guard prevents a tiny rebound from
                // ending a rep before the person has substantially risen.
                const minimumReturnMovement = Math.max(DETECTOR.minimumRiseFromBottomDegrees, repExcursion * DETECTOR.returnFromBottomFraction);
                const returnLevel = EXERCISE.descentDirection === 'decrease'
                  ? Math.max(repTop - returnOffset, repBottom + minimumReturnMovement)
                  : Math.min(repTop + returnOffset, repBottom - minimumReturnMovement);
                const returned = EXERCISE.descentDirection === 'decrease' ? smoothed >= returnLevel : smoothed <= returnLevel;
                if (returned) {
                  const bottom = lowRef.current ?? smoothed;
                  const baseline = startAngleRef.current ?? smoothed;
                  const excursion = EXERCISE.descentDirection === 'decrease' ? baseline - bottom : bottom - baseline;
                  const repSamples = repSamplesRef.current;
                  const duration = Math.max(0, now / 1000 - (startTimeRef.current ?? now / 1000));
                  const gap = lastRepEndTimeRef.current === null ? null : now / 1000 - lastRepEndTimeRef.current;
                  const validation = EXERCISE.strategy.validateRep(repSamples, {
                    excursion, minimumMovement: excursionThresholdRef.current, duration,
                    minimumDuration: DETECTOR.minimumRepDurationSeconds, gap, minimumGap: DETECTOR.minimumRepGapSeconds,
                  });
                  const leftExcursion = validation.diagnostics.left_excursion;
                  const rightExcursion = validation.diagnostics.right_excursion;
                  const leftVisibleFrames = validation.diagnostics.left_visible_frames ?? 0;
                  const rightVisibleFrames = validation.diagnostics.right_visible_frames ?? 0;
                  const bottomAsymmetry = validation.diagnostics.bottom_asymmetry;
                  const minBilateralMovement = validation.diagnostics.bilateral_minimum ?? 0;
                  const bilateralRatio = validation.diagnostics.bilateral_ratio;
                  const rejectionReasons = validation.accepted ? [] : [validation.reason];
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
                    reason: validation.reason,
                  });
                  if (event === 'counted') {
                    lastRepEndTimeRef.current = now / 1000;
                    if (sessionStartTimeRef.current !== null) {
                      const repMarker = (now - sessionStartTimeRef.current) / 1000;
                      setRepMarkers((markers) => [...markers.filter((time) => time >= repMarker - 30), repMarker]);
                    }
                    const samples = repSamplesRef.current;
                    const kneeConfigured = minAngle !== '' && maxAngle !== '';
                    const prescribedKneeRange = kneeConfigured
                      ? toKinexaKneeRange(Number(minAngle), Number(maxAngle), kneeAngleConvention)
                      : null;
                    const assessment = EXERCISE.strategy.assessRep(samples, {
                      ...(prescribedKneeRange ? { knee_angle: prescribedKneeRange } : {}),
                      ...(maxTrunkAngle !== '' ? { trunk_lean: { max: Number(maxTrunkAngle) } } : {}),
                      ...(maxAsymmetry !== '' ? { knee_asymmetry: { max: Number(maxAsymmetry) } } : {}),
                    });
                    const asymmetry = assessment.metrics.find((metric) => metric.name === 'knee_asymmetry')?.value ?? null;
                    const peakTrunkLean = assessment.metrics.find((metric) => metric.name === 'trunk_lean')?.value ?? null;
                    const verdict: Rep['verdict'] = assessment.feedbackStatus === 'outside_limits'
                      ? 'outside range'
                      : assessment.feedbackStatus === 'not_assessable'
                        ? 'not assessable'
                        : assessment.feedbackStatus === 'within_limits'
                          ? 'within range'
                          : 'range not set';
                    const cues = assessment.cues;
                    const number = ++repNumberRef.current;
                    const modelFeatures = assessment.modelFeatures;
                    const bottomSample = samples.reduce((target, sample) => EXERCISE.descentDirection === 'decrease'
                      ? (sample.primaryKnee < target.primaryKnee ? sample : target)
                      : (sample.primaryKnee > target.primaryKnee ? sample : target));
                    const measurements: Rep['measurements'] = [
                      ...(bottomSample.leftKnee === null ? [] : [{ metric: 'knee_angle', side: 'left', phase: TARGET_PHASE, value: bottomSample.leftKnee, unit: 'deg' }]),
                      ...(bottomSample.rightKnee === null ? [] : [{ metric: 'knee_angle', side: 'right', phase: TARGET_PHASE, value: bottomSample.rightKnee, unit: 'deg' }]),
                      ...(asymmetry === null ? [] : [{ metric: 'asymmetry', side: 'either', phase: TARGET_PHASE, value: asymmetry, unit: 'deg' }]),
                      ...(peakTrunkLean === null ? [] : [{ metric: 'trunk_lean', side: 'either', phase: 'at_peak', value: peakTrunkLean, unit: 'deg' }]),
                    ];
                    const sessionStartSeconds = (sessionStartTimeRef.current ?? now) / 1000;
                    setReps((old) => [...old, {
                      number, angle: Math.round(bottom), primaryLabel: assessment.primaryMetric.label, asymmetry, maxTrunkLean: peakTrunkLean, duration,
                      verdict, cue: cues.join(' '), measurements, advice: [],
                      start_s: Math.max(0, (samples[0]?.time ?? now / 1000) - sessionStartSeconds),
                      bottom_s: Math.max(0, bottomSample.time - sessionStartSeconds),
                      end_s: Math.max(0, now / 1000 - sessionStartSeconds),
                      model: { status: 'checking' },
                    }]);
                    if (patientId.trim() && savedPlanLoaded) {
                      void requestPatientAdvice(EXERCISE.id, patientId.trim(), measurements).then((coaching) => {
                        setReps((old) => old.map((rep) => rep.number === number ? {
                          ...rep,
                          advice: coaching.advice,
                          cue: coaching.advice.length ? coaching.advice.map((item) => item.message).join(' ') : (coaching.personalized ? (coaching.message || cues.join(' ')) : cues.join(' ')),
                        } : rep));
                      }).catch((error: unknown) => {
                        setDatabaseMessage(error instanceof Error ? error.message : 'Patient-specific advice is unavailable.');
                      });
                    }
                    const modelAssessment = EXERCISE.readiness === 'rules_only'
                      ? Promise.resolve({
                          status: 'skipped' as const,
                          reason: 'No quality model is trained for this exercise; feedback comes from its movement strategy and prescribed ROM.',
                        })
                      : requestExerciseModel(EXERCISE.id, modelFeatures);
                    void modelAssessment.then((model) => {
                      setReps((old) => old.map((rep) => rep.number === number ? { ...rep, model } : rep));
                    });
                  } else setPhase('Rep not counted · see detector log');
                  phaseRef.current = 'ready'; lowRef.current = null; startAngleRef.current = null;
                  startTimeRef.current = null; repSamplesRef.current = []; setPhase('Return to a comfortable start');
                }
                else if (EXERCISE.descentDirection === 'decrease' ? smoothed > (lowRef.current ?? smoothed) + 5 : smoothed < (lowRef.current ?? smoothed) - 5) setPhase(EXERCISE.descentDirection === 'decrease' ? 'Rise with control' : 'Return with control');
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
  const prescribedKneeRange = minAngle !== '' && maxAngle !== ''
    ? toKinexaKneeRange(Number(minAngle), Number(maxAngle), kneeAngleConvention)
    : null;
  return (
    <main className="app-shell">
      <header className="topbar"><a className="brand" href="#">KINEXA<span>MOVE BETTER, WITH GUIDANCE</span></a><div className="live-indicator"><i className={running ? 'pulse on' : 'pulse'} />{running ? 'LIVE SESSION' : 'SESSION READY'}</div></header>
      <section className="intro"><div><p className="eyebrow">REHABILITATION · {EXERCISE.label.toUpperCase()} PRACTICE</p><h1>Your movement,<br/><em>in the moment.</em></h1><p className="lede">Real-time pose guidance with a range set for your recovery.</p><label className="exercise-picker">EXERCISE<select value={exerciseId} disabled={running || loading} onChange={(event) => setExerciseId(event.target.value)}>{Object.values(LIVE_EXERCISES).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div><div className="session-meta"><span>01 / LIVE COACH</span><span>{EXERCISE.cameraGuidance}</span><span>{readiness === 'camera_validated' ? 'CAMERA VALIDATED' : readiness === 'model_advisory' ? 'MODEL ADVISORY' : 'RULES ONLY'}</span><small>{readinessReason}</small></div></section>
      <section className="workspace">
        <div className="camera-column">
          <div className="camera-frame"><video ref={videoRef} muted playsInline/><canvas ref={canvasRef} className="pose-canvas"/>{!running && <div className="camera-placeholder"><div className="camera-mark">◎</div><b>Set up your camera</b><span>Position the camera at hip height, far enough away to show your full body.</span></div>}<div className="camera-badge"><i className={running ? 'pulse on' : 'pulse'}/>{running ? tracking : 'CAMERA PREVIEW'}</div>{angleNow !== null && <div className="angle-overlay"><span>{EXERCISE.angleLabel.toUpperCase()}</span><b>{angleNow}°</b></div>}</div>
          <div className="camera-actions"><div><span className="micro-label">CAMERA POSITION</span><b>{EXERCISE.cameraGuidance}</b></div><div className="camera-button-stack"><button className={running ? 'button button-stop' : 'button'} onClick={running ? stop : start} disabled={loading}>{loading ? 'Preparing camera…' : running ? 'End session' : 'Start live session'}<span aria-hidden="true">{running ? '×' : '↗'}</span></button>{!running && reps.length > 0 && <button className="button button-secondary" onClick={saveLiveSession} disabled={savingSession}>{savingSession ? 'Saving…' : 'Save session'}<span aria-hidden="true">↓</span></button>}</div></div>
          {error && <p className="error-banner" role="alert">{error}</p>}
          <div className="safety-note"><span>i</span><p>Keep a stable chair or support nearby. Stop if you feel pain, dizziness, or unusual discomfort.</p></div>
        </div>
        <aside className="coach-column">
          <div className="panel-heading"><div><p className="eyebrow">YOUR SESSION</p><h2>Live coach</h2></div><span className="rep-count"><b>{reps.length.toString().padStart(2, '0')}</b><small>REPS</small></span></div>
          <div className="phase-card"><span className="micro-label">MOVEMENT CUE</span><strong>{running ? phase : 'Ready when you are'}</strong><p>{latest?.cue ?? (running ? 'Move at a comfortable pace. Feedback appears after each completed rep.' : 'Start the camera to see your pose and movement cues.')}</p></div>
          <div className="metric-row">
            <div><span className="micro-label">{EXERCISE.angleLabel.toUpperCase()}</span><b>{angleNow === null ? '—' : `${angleNow}°`}</b></div>
            <div><span className="micro-label">TRUNK LEAN</span><b>{trunkNow === null ? '—' : `${trunkNow}°`}</b></div>
            <div><span className="micro-label">ASYMMETRY</span><b>{asymmetryNow === null ? '—' : `${asymmetryNow}°`}</b></div>
          </div>
          <section className="angle-chart-panel" aria-label={`${EXERCISE.angleLabel} over time`}>
            <div className="angle-chart-header"><span className="micro-label">{EXERCISE.angleLabel.toUpperCase()} · LAST 30 SECONDS</span><div className="angle-chart-legend"><span><i className="legend-left"/>Your left knee</span><span><i className="legend-right"/>Your right knee</span>{minAngle !== '' && maxAngle !== '' && <span><i className="legend-range"/>Prescribed range</span>}<span><i className="legend-rep"/>Counted rep</span></div></div>
            <p className="angle-chart-note">Left and right refer to your body; the camera preview is mirrored. A knee trace is omitted when its hip, knee, or ankle is not clearly visible.</p>
            {angleHistory.length > 1 ? <div className="angle-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={angleHistory} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#e8ece7" strokeDasharray="3 4" vertical={false}/>
              <XAxis dataKey="seconds" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => `${value.toFixed(0)}s`} tick={{ fill: '#87928d', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#e3e8e2' }} minTickGap={24}/>
              <YAxis type="number" domain={[30, 180]} ticks={[60, 90, 120, 150, 180]} tickFormatter={(value: number) => `${value}°`} tick={{ fill: '#87928d', fontSize: 9 }} tickLine={false} axisLine={false} width={42}/>
              <Tooltip labelFormatter={(value: number) => `${Number(value).toFixed(1)} seconds`} formatter={(value: number, name: string) => [`${value}°`, name]} contentStyle={{ border: '1px solid #e3e8e2', borderRadius: 2, fontSize: 10 }}/>
              {prescribedKneeRange && <ReferenceArea y1={prescribedKneeRange.min} y2={prescribedKneeRange.max} fill="#79d69d" fillOpacity={0.16} strokeOpacity={0}/>}
              {repMarkers.map((time, index) => <ReferenceLine key={`rep-${index}-${time.toFixed(2)}`} x={time} stroke="#81918a" strokeDasharray="3 4" strokeWidth={1}/>) }
              <Line type="monotone" dataKey="leftKnee" name="Your left knee" stroke="#167c69" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/>
              <Line type="monotone" dataKey="rightKnee" name="Your right knee" stroke="#d69b35" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/>
            </LineChart></ResponsiveContainer></div> : <p className="angle-chart-empty">Start the camera to see both knee angles move through the session.</p>}
          </section>
          <div className="rom-panel">
            <div className="rom-title"><div><p className="eyebrow">PERSONAL RANGE</p><h3>Therapist-set ROM</h3></div><span className="lock-tag">POSTGRESQL</span></div>
            <p className="rom-copy">Load or save this patient’s active therapist plan. Advice compares each rep’s measured values with the saved limits; the ML signal stays a separate general advisory.</p>
            <div className="patient-plan-controls"><label>Patient ID<input value={patientId} disabled={running} onChange={(event) => { setPatientId(event.target.value); setSavedPlanLoaded(false); setMinAngle(''); setMaxAngle(''); setMaxTrunkAngle(''); setMaxAsymmetry(''); }} placeholder="Existing patient ID"/></label><div><button type="button" onClick={loadPatientPlan} disabled={running}>Load plan</button><button type="button" onClick={savePatientPlan} disabled={running}>Save as plan</button></div></div>
            <details className="new-patient"><summary>Create a patient record</summary><div><input value={therapistId} disabled={running} onChange={(event) => setTherapistId(event.target.value)} placeholder="Therapist ID"/><input value={newPatientName} disabled={running} onChange={(event) => setNewPatientName(event.target.value)} placeholder="Patient name"/><button type="button" onClick={createPatient} disabled={running}>Create patient</button></div></details>
            {databaseMessage && <p className="database-message" role="status">{databaseMessage}</p>}
            <div className="range-inputs">
              <label>Knee angle format<select value={kneeAngleConvention} disabled={running} onChange={(e) => { setKneeAngleConvention(e.target.value as KneeAngleConvention); setSavedPlanLoaded(false); }}><option value="joint_angle">Inside knee angle · 180° straight</option><option value="flexion">Flexion from straight · 0° straight</option></select></label>
              <label>Minimum allowed angle at target <span><input type="number" min={kneeAngleConvention === 'flexion' ? 0 : 30} max={kneeAngleConvention === 'flexion' ? 150 : 180} placeholder={kneeAngleConvention === 'flexion' ? 'e.g. 50' : 'e.g. 105'} value={minAngle} disabled={running} onChange={(e) => { setMinAngle(e.target.value); setSavedPlanLoaded(false); }}/>°</span></label>
              <label>Maximum allowed angle at target <span><input type="number" min={kneeAngleConvention === 'flexion' ? 0 : 30} max={kneeAngleConvention === 'flexion' ? 150 : 180} placeholder={kneeAngleConvention === 'flexion' ? 'e.g. 75' : 'e.g. 130'} value={maxAngle} disabled={running} onChange={(e) => { setMaxAngle(e.target.value); setSavedPlanLoaded(false); }}/>°</span></label>
              <label>Maximum trunk lean <span><input type="number" min="0" max="90" placeholder="optional" value={maxTrunkAngle} disabled={running} onChange={(e) => { setMaxTrunkAngle(e.target.value); setSavedPlanLoaded(false); }}/>°</span></label>
              <label>Maximum asymmetry <span><input type="number" min="0" max="90" placeholder="optional" value={maxAsymmetry} disabled={running} onChange={(e) => { setMaxAsymmetry(e.target.value); setSavedPlanLoaded(false); }}/>°</span></label>
              <label>Minimum knee movement <span><input type="number" min={DETECTOR.minimumUserMovementDegrees} max={DETECTOR.maximumUserMovementDegrees} value={minRepMovement} disabled={running} onChange={(e) => setMinRepMovement(e.target.value)}/>°</span></label>
            </div>
            <p className="local-hint">If the prescription says flexion from straight, choose that format; for example, 50°–75° flexion becomes a 105°–130° inside-angle range. Minimum movement (default {DETECTOR.minRepMovementDegrees}°) is separate from ROM. {savedPlanLoaded ? 'Using the saved plan for personalized advice.' : 'Save or reload the plan before using patient-specific advice.'}</p>
          </div>
          <div className="rep-list"><div className="list-head"><h3>Recent reps</h3><span>{reps.length ? `${reps.length} recorded` : 'No reps yet'}</span></div>{latest ? <div className="rep-item"><span className="rep-number">{String(latest.number).padStart(2, '0')}</span><div><b>{latest.primaryLabel} · {latest.angle}°{latest.maxTrunkLean === null ? '' : ` · trunk ${latest.maxTrunkLean}°`}{latest.asymmetry === null ? '' : ` · asymmetry ${latest.asymmetry}°`}</b><small>{latest.duration.toFixed(1)} s · {latest.cue}</small><small className="model-note">{describeModelAssessment(latest.model)}</small></div><span className={`verdict ${latest.verdict === 'within range' ? 'pass' : latest.verdict === 'not assessable' ? 'unassessable' : 'pending'}`}>{latest.verdict === 'within range' ? 'LIMITS OK' : latest.verdict === 'range not set' ? 'SET ROM' : latest.verdict === 'not assessable' ? 'NOT ASSESSABLE' : 'REVIEW'}</span></div> : <p className="empty-reps">Your completed reps and cues will appear here.</p>}</div>
          <details className="detector-log">
            <summary>Rep detector log · {detectorLogs.length} recent events</summary>
            <p>Each event shows knee travel on both sides, target-position angle difference, visibility, duration, and spacing. A rep needs at least {DETECTOR.minimumBilateralMovementDegrees}° travel in each knee and no more than {DETECTOR.maximumCountedKneeAsymmetryDegrees}° difference at the target. The same structured entries are written to the browser console as <code>[Kinexa rep detector]</code>.</p>
            {detectorLogs.length ? <ol>{[...detectorLogs].reverse().map((entry, index) => <li key={`${entry.time}-${entry.event}-${index}`}><b>{entry.event.toUpperCase()}</b><span>{entry.time} · angle {entry.angle}° · start {entry.baseline}°{entry.bottom === null ? '' : ` · bottom ${entry.bottom}°`} · travel {entry.excursion}° / {entry.minMovement}° minimum · left {entry.leftExcursion === null ? '—' : `${entry.leftExcursion}°`} · right {entry.rightExcursion === null ? '—' : `${entry.rightExcursion}°`} / {entry.minBilateralMovement}° each minimum · target difference {entry.bottomAsymmetry === null ? '—' : `${entry.bottomAsymmetry}°`} / {DETECTOR.maximumCountedKneeAsymmetryDegrees}° maximum · visible L/R {entry.leftVisibleFrames ?? '—'}/{entry.repFrames ?? '—'} · {entry.rightVisibleFrames ?? '—'}/{entry.repFrames ?? '—'} frames · balance {entry.bilateralRatio === null ? '—' : `${Math.round(entry.bilateralRatio * 100)}%`} / {Math.round(DETECTOR.minimumBilateralTravelRatio * 100)}% minimum · duration {entry.duration}s / {entry.minDuration}s minimum{entry.gap === null ? '' : ` · gap ${entry.gap}s / ${entry.minGap}s minimum`}</span>{entry.reason && <small>{entry.reason}</small>}</li>)}</ol> : <small>No movement events logged yet. Start the camera and move through one cycle.</small>}
          </details>
        </aside>
      </section>
      <footer className="disclaimer"><span>FOR GUIDANCE ONLY</span><p>Kinexa is a movement feedback prototype, not a medical device. Angle estimates can be affected by camera position and visibility. Follow your physiotherapist’s advice.</p><span>V0.2 · LIVE</span></footer>
    </main>
  );
}
