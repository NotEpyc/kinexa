'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Point = { x: number; y: number; z: number; visibility?: number };
type Rep = {
  number: number;
  angle: number;
  asymmetry: number | null;
  maxTrunkLean: number | null;
  duration: number;
  verdict: 'within range' | 'outside range' | 'range not set' | 'not assessable';
  cue: string;
};
type RepSample = {
  time: number;
  leftKnee: number | null;
  rightKnee: number | null;
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

const MIN_REP_DURATION_SECONDS = 0.7;
const MIN_REP_GAP_SECONDS = 0.8;
const MIN_BILATERAL_TRAVEL_RATIO = 0.35;

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
  const lowRef = useRef<number | null>(null);
  const startAngleRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const lastRepEndTimeRef = useRef<number | null>(null);
  const startTriggerThresholdRef = useRef(0);
  const repSamplesRef = useRef<RepSample[]>([]);
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
  const [minRepMovement, setMinRepMovement] = useState('20');
  const [reps, setReps] = useState<Rep[]>([]);
  const [detectorLogs, setDetectorLogs] = useState<DetectorLog[]>([]);
  const [angleHistory, setAngleHistory] = useState<AngleHistoryPoint[]>([]);
  const [repMarkers, setRepMarkers] = useState<number[]>([]);

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
      phaseRef.current = 'ready'; baselineRef.current = null; lowRef.current = null; startAngleRef.current = null;
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
            const leftVisible = [23, 25, 27].every((i) => (screen[i]?.visibility ?? 0) >= 0.45);
            const rightVisible = [24, 26, 28].every((i) => (screen[i]?.visibility ?? 0) >= 0.45);
            const left = leftVisible ? angle(points[23], points[25], points[27]) : null;
            const right = rightVisible ? angle(points[24], points[26], points[28]) : null;
            const currentTrunkLean = trunkLean(points, screen);
            const candidate = left !== null && right !== null ? (Math.min(screen[23].visibility ?? 0, screen[25].visibility ?? 0, screen[27].visibility ?? 0) >= Math.min(screen[24].visibility ?? 0, screen[26].visibility ?? 0, screen[28].visibility ?? 0) ? left : right) : left ?? right;
            if (candidate !== null) {
              const now = performance.now();
              const smoothed = smoothedAngleRef.current === null ? candidate : smoothedAngleRef.current * 0.72 + candidate * 0.28;
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
                primaryKnee: candidate,
                trunkLean: currentTrunkLean,
              };
              if (phaseRef.current === 'descending') repSamplesRef.current.push(sample);
              if (phaseRef.current === 'ready') {
                const baseline = baselineRef.current;
                if (baseline === null) baselineRef.current = smoothed;
                else if (smoothed >= baseline - 3) baselineRef.current = baseline * 0.92 + smoothed * 0.08;
                const calibratedTop = baselineRef.current ?? candidate;
                const startThreshold = Math.max(6, Math.min(14, Math.round(Number(minRepMovement) * 0.5)));
                if (smoothed <= calibratedTop - startThreshold) {
                  phaseRef.current = 'descending'; lowRef.current = smoothed; startAngleRef.current = calibratedTop;
                  startTimeRef.current = now / 1000; repSamplesRef.current = [sample];
                  startTriggerThresholdRef.current = startThreshold;
                  excursionThresholdRef.current = Number(minRepMovement); setPhase('Lower with control');
                  logDetector({
                    time: new Date().toLocaleTimeString(), event: 'started', angle: Math.round(smoothed),
                    baseline: Math.round(calibratedTop), bottom: null, excursion: 0, triggerThreshold: startThreshold,
                    leftExcursion: null, rightExcursion: null,
                    minBilateralMovement: Math.max(10, Math.round(Number(minRepMovement) * 0.5)),
                    bilateralRatio: null,
                    minMovement: Number(minRepMovement), duration: 0, minDuration: MIN_REP_DURATION_SECONDS,
                    gap: lastRepEndTimeRef.current === null ? null : Number((now / 1000 - lastRepEndTimeRef.current).toFixed(2)),
                    minGap: MIN_REP_GAP_SECONDS,
                  });
                }
              } else if (phaseRef.current === 'descending') {
                lowRef.current = Math.min(lowRef.current ?? smoothed, smoothed);
                const returnThreshold = Math.max(4, Math.min(7, Math.round((startAngleRef.current ?? candidate) * 0.03)));
                if (smoothed >= (startAngleRef.current ?? smoothed) - returnThreshold) {
                  const bottom = lowRef.current ?? smoothed;
                  const baseline = startAngleRef.current ?? smoothed;
                  const excursion = baseline - bottom;
                  const repSamples = repSamplesRef.current;
                  const leftStart = repSamples[0]?.leftKnee ?? null;
                  const rightStart = repSamples[0]?.rightKnee ?? null;
                  const leftBottom = repSamples.reduce<number | null>((lowest, current) => current.leftKnee === null ? lowest : Math.min(lowest ?? current.leftKnee, current.leftKnee), null);
                  const rightBottom = repSamples.reduce<number | null>((lowest, current) => current.rightKnee === null ? lowest : Math.min(lowest ?? current.rightKnee, current.rightKnee), null);
                  const leftExcursion = leftStart !== null && leftBottom !== null ? Number((leftStart - leftBottom).toFixed(1)) : null;
                  const rightExcursion = rightStart !== null && rightBottom !== null ? Number((rightStart - rightBottom).toFixed(1)) : null;
                  const bilateralRatio = leftExcursion !== null && rightExcursion !== null
                    ? Number((Math.min(leftExcursion, rightExcursion) / Math.max(leftExcursion, rightExcursion, 1)).toFixed(2))
                    : null;
                  const minBilateralMovement = Math.max(10, Math.round(excursionThresholdRef.current * 0.5));
                  const duration = Math.max(0, now / 1000 - (startTimeRef.current ?? now / 1000));
                  const gap = lastRepEndTimeRef.current === null ? null : now / 1000 - lastRepEndTimeRef.current;
                  const rejectionReasons: string[] = [];
                  if (excursion < excursionThresholdRef.current) rejectionReasons.push(`movement ${excursion.toFixed(1)}° was below ${excursionThresholdRef.current}° minimum`);
                  if (leftExcursion === null || rightExcursion === null) rejectionReasons.push('both knee angles were unavailable at the rep start or during movement, so bilateral movement could not be confirmed');
                  else if (leftExcursion < minBilateralMovement || rightExcursion < minBilateralMovement) rejectionReasons.push(`both knees must move at least ${minBilateralMovement}° (left ${leftExcursion}°, right ${rightExcursion}°)`);
                  else if (bilateralRatio !== null && bilateralRatio < MIN_BILATERAL_TRAVEL_RATIO) rejectionReasons.push(`knee travel was too one-sided (left ${leftExcursion}°, right ${rightExcursion}°; weaker side ${Math.round(bilateralRatio * 100)}% of stronger side, minimum ${Math.round(MIN_BILATERAL_TRAVEL_RATIO * 100)}%)`);
                  if (duration < MIN_REP_DURATION_SECONDS) rejectionReasons.push(`rep duration ${duration.toFixed(2)}s was below ${MIN_REP_DURATION_SECONDS}s minimum`);
                  if (gap !== null && gap < MIN_REP_GAP_SECONDS) rejectionReasons.push(`rep gap ${gap.toFixed(2)}s was below ${MIN_REP_GAP_SECONDS}s minimum`);
                  const event = rejectionReasons.length ? 'rejected' : 'counted';
                  logDetector({
                    time: new Date().toLocaleTimeString(), event, angle: Math.round(smoothed),
                    baseline: Math.round(baseline), bottom: Math.round(bottom), excursion: Number(excursion.toFixed(1)),
                    leftExcursion, rightExcursion, minBilateralMovement, bilateralRatio,
                    triggerThreshold: startTriggerThresholdRef.current, minMovement: excursionThresholdRef.current,
                    duration: Number(duration.toFixed(2)), minDuration: MIN_REP_DURATION_SECONDS,
                    gap: gap === null ? null : Number(gap.toFixed(2)), minGap: MIN_REP_GAP_SECONDS,
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
                    setReps((old) => [...old, { number: old.length + 1, angle: Math.round(bottom), asymmetry, maxTrunkLean: peakTrunkLean, duration, verdict, cue: cues.join(' ') }]);
                  } else setPhase('Rep not counted · see detector log');
                  phaseRef.current = 'ready'; lowRef.current = null; startAngleRef.current = null;
                  startTimeRef.current = null; repSamplesRef.current = []; setPhase('Return to a comfortable start');
                }
                else if (smoothed > (lowRef.current ?? smoothed) + 5) setPhase('Rise with control');
              }
            }
            else { setTracking('Pose detected · move knees and ankles into view'); setAngleNow(null); setTrunkNow(null); setAsymmetryNow(null); }
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
      <section className="intro"><div><p className="eyebrow">REHABILITATION · SQUAT PRACTICE</p><h1>Your movement,<br/><em>in the moment.</em></h1><p className="lede">Real-time pose guidance with a range set for your recovery.</p></div><div className="session-meta"><span>01 / LIVE COACH</span><span>Side view recommended</span></div></section>
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
            <p className="angle-chart-note">Left and right refer to your body; the camera preview is mirrored.</p>
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
              <label>Minimum knee movement <span><input type="number" min="8" max="45" value={minRepMovement} disabled={running} onChange={(e) => setMinRepMovement(e.target.value)}/>°</span></label>
            </div>
            <p className="local-hint">Minimum knee movement (default 20°) is a rep-detection threshold, separate from prescribed ROM. These settings stay in this browser for now; patient plans are not connected yet.</p>
          </div>
          <div className="rep-list"><div className="list-head"><h3>Recent reps</h3><span>{reps.length ? `${reps.length} recorded` : 'No reps yet'}</span></div>{latest ? <div className="rep-item"><span className="rep-number">{String(latest.number).padStart(2, '0')}</span><div><b>Bottom knee · {latest.angle}°{latest.maxTrunkLean === null ? '' : ` · trunk ${latest.maxTrunkLean}°`}{latest.asymmetry === null ? '' : ` · asymmetry ${latest.asymmetry}°`}</b><small>{latest.duration.toFixed(1)} s · {latest.cue}</small></div><span className={`verdict ${latest.verdict === 'within range' ? 'pass' : latest.verdict === 'not assessable' ? 'unassessable' : 'pending'}`}>{latest.verdict === 'within range' ? 'LIMITS OK' : latest.verdict === 'range not set' ? 'SET ROM' : latest.verdict === 'not assessable' ? 'NOT ASSESSABLE' : 'REVIEW'}</span></div> : <p className="empty-reps">Your completed reps and cues will appear here.</p>}</div>
          <details className="detector-log">
            <summary>Rep detector log · {detectorLogs.length} recent events</summary>
            <p>Each event shows knee travel on both sides, travel balance, duration, and spacing. A rep needs at least 10° travel in each knee, with the weaker side reaching at least 35% of the stronger side. The same structured entries are written to the browser console as <code>[Kinexa rep detector]</code>.</p>
            {detectorLogs.length ? <ol>{[...detectorLogs].reverse().map((entry, index) => <li key={`${entry.time}-${entry.event}-${index}`}><b>{entry.event.toUpperCase()}</b><span>{entry.time} · angle {entry.angle}° · top {entry.baseline}°{entry.bottom === null ? '' : ` · bottom ${entry.bottom}°`} · travel {entry.excursion}° / {entry.minMovement}° minimum · left {entry.leftExcursion === null ? '—' : `${entry.leftExcursion}°`} · right {entry.rightExcursion === null ? '—' : `${entry.rightExcursion}°`} / {entry.minBilateralMovement}° each minimum · balance {entry.bilateralRatio === null ? '—' : `${Math.round(entry.bilateralRatio * 100)}%`} / 35% minimum · duration {entry.duration}s / {entry.minDuration}s minimum{entry.gap === null ? '' : ` · gap ${entry.gap}s / ${entry.minGap}s minimum`}</span>{entry.reason && <small>{entry.reason}</small>}</li>)}</ol> : <small>No movement events logged yet. Start the camera and move through one cycle.</small>}
          </details>
        </aside>
      </section>
      <footer className="disclaimer"><span>FOR GUIDANCE ONLY</span><p>Kinexa is a movement feedback prototype, not a medical device. Angle estimates can be affected by camera position and visibility. Follow your physiotherapist’s advice.</p><span>V0.2 · LIVE</span></footer>
    </main>
  );
}
