'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

type Point = { x: number; y: number; z: number; visibility?: number };
type Rep = { number: number; angle: number; verdict: 'within range' | 'outside range'; cue: string };

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
  const excursionThresholdRef = useRef(12);
  const lastFrameTimeRef = useRef(-1);
  const lastUiUpdateRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [angleNow, setAngleNow] = useState<number | null>(null);
  const [phase, setPhase] = useState('Camera off');
  const [tracking, setTracking] = useState('Waiting for camera');
  const [minAngle, setMinAngle] = useState('');
  const [maxAngle, setMaxAngle] = useState('');
  const [reps, setReps] = useState<Rep[]>([]);

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
            const leftVisible = [23, 25, 27].every((i) => (screen[i]?.visibility ?? 0) >= 0.45);
            const rightVisible = [24, 26, 28].every((i) => (screen[i]?.visibility ?? 0) >= 0.45);
            const left = leftVisible ? angle(points[23], points[25], points[27]) : null;
            const right = rightVisible ? angle(points[24], points[26], points[28]) : null;
            const candidate = left !== null && right !== null ? (Math.min(screen[23].visibility ?? 0, screen[25].visibility ?? 0, screen[27].visibility ?? 0) >= Math.min(screen[24].visibility ?? 0, screen[26].visibility ?? 0, screen[28].visibility ?? 0) ? left : right) : left ?? right;
            if (candidate !== null) {
              if (performance.now() - lastUiUpdateRef.current > 150) { setAngleNow(candidate); lastUiUpdateRef.current = performance.now(); }
              if (phaseRef.current === 'ready') {
                const baseline = baselineRef.current;
                if (baseline === null) baselineRef.current = candidate;
                else if (candidate >= baseline - 3) baselineRef.current = baseline * 0.92 + candidate * 0.08;
                const calibratedTop = baselineRef.current ?? candidate;
                const configured = minAngle !== '' && maxAngle !== '';
                const expectedDepthChange = configured ? calibratedTop - Number(maxAngle) : 12;
                const startThreshold = configured
                  ? Math.max(3, Math.min(12, Math.round(expectedDepthChange * 0.5)))
                  : 12;
                if (candidate <= calibratedTop - startThreshold) {
                  phaseRef.current = 'descending'; lowRef.current = candidate; startAngleRef.current = calibratedTop; excursionThresholdRef.current = startThreshold; setPhase('Lower with control');
                }
              } else if (phaseRef.current === 'descending') {
                lowRef.current = Math.min(lowRef.current ?? candidate, candidate);
                const returnThreshold = Math.max(4, Math.min(7, Math.round((startAngleRef.current ?? candidate) * 0.03)));
                if (candidate >= (startAngleRef.current ?? candidate) - returnThreshold) {
                  const bottom = lowRef.current ?? candidate;
                  if ((startAngleRef.current ?? candidate) - bottom >= excursionThresholdRef.current) {
                    const lo = Number(minAngle); const hi = Number(maxAngle); const configured = minAngle !== '' && maxAngle !== ''; const inRange = configured && bottom >= lo && bottom <= hi; const verdict = inRange ? 'within range' : 'outside range'; const cue = !configured ? 'Set your therapist-prescribed knee range to assess reps.' : bottom < lo ? 'You moved beyond the prescribed depth. Reduce squat depth.' : bottom > hi ? 'Reach the prescribed depth, if comfortable.' : 'Depth is within your prescribed range.'; setReps((old) => [...old, { number: old.length + 1, angle: bottom, verdict, cue }]);
                  }
                  phaseRef.current = 'ready'; lowRef.current = null; startAngleRef.current = null; setPhase('Return to a comfortable start');
                }
                else if (candidate > (lowRef.current ?? candidate) + 5) setPhase('Rise with control');
              }
            }
          } else { setTracking('No pose — step back into view'); setAngleNow(null); }
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
          <div className="metric-row"><div><span className="micro-label">KNEE ANGLE</span><b>{angleNow === null ? '—' : `${angleNow}°`}</b></div><div><span className="micro-label">TRACKING</span><b className="tracking-text">{running ? (tracking === 'Pose detected' ? 'Good' : 'Adjust') : 'Off'}</b></div></div>
          <div className="rom-panel"><div className="rom-title"><div><p className="eyebrow">PERSONAL RANGE</p><h3>Therapist-set ROM</h3></div><span className="lock-tag">LOCAL</span></div><p className="rom-copy">Enter the knee angle range prescribed for this patient. A rep is assessed at its deepest point.</p><div className="range-inputs"><label>Minimum angle <span><input type="number" min="30" max="180" placeholder="e.g. 80" value={minAngle} onChange={(e) => setMinAngle(e.target.value)}/>°</span></label><label>Maximum angle <span><input type="number" min="30" max="180" placeholder="e.g. 110" value={maxAngle} onChange={(e) => setMaxAngle(e.target.value)}/>°</span></label></div><p className="local-hint">These settings are held in this browser only; patient plans are not connected yet.</p></div>
          <div className="rep-list"><div className="list-head"><h3>Recent reps</h3><span>{reps.length ? `${reps.length} recorded` : 'No reps yet'}</span></div>{latest ? <div className="rep-item"><span className="rep-number">{String(latest.number).padStart(2, '0')}</span><div><b>Bottom angle · {latest.angle}°</b><small>{latest.cue}</small></div><span className={latest.verdict === 'within range' ? 'verdict pass' : 'verdict pending'}>{latest.verdict === 'within range' ? 'IN RANGE' : minAngle && maxAngle ? 'REVIEW' : 'SET ROM'}</span></div> : <p className="empty-reps">Your completed reps and cues will appear here.</p>}</div>
        </aside>
      </section>
      <footer className="disclaimer"><span>FOR GUIDANCE ONLY</span><p>Kinexa is a movement feedback prototype, not a medical device. Angle estimates can be affected by camera position and visibility. Follow your physiotherapist’s advice.</p><span>V0.2 · LIVE</span></footer>
    </main>
  );
}
