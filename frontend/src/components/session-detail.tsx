'use client';

import { useEffect, useState } from 'react';

type RepDetail = {
  rep: number;
  status: string;
  start_s: number;
  bottom_s: number;
  end_s: number;
  measurements: Record<string, unknown>;
  ml?: Record<string, unknown> | null;
  issues: Array<string | { code?: string; message?: string; severity?: string }>;
  advice: Array<{ code?: string; source?: string; message?: string }>;
};

type AnalysisDetail = {
  analysis_id: string;
  exercise: string;
  source: string;
  model_version: string;
  score: number;
  total_reps: number;
  correct_reps: number;
  incorrect_reps: number;
  created_at: string;
  constraints_snapshot: Record<string, unknown>;
  warnings: string[];
  reps: RepDetail[];
};

function titleFor(key: string) {
  return key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function measurementValue(raw: unknown) {
  if (typeof raw === 'number') return `${raw.toFixed(1)}`;
  if (raw && typeof raw === 'object') {
    const item = raw as { value?: unknown; unit?: unknown };
    if (typeof item.value === 'number') return `${item.value.toFixed(1)}${typeof item.unit === 'string' ? ` ${item.unit}` : ''}`;
  }
  return typeof raw === 'string' ? raw : '—';
}

export default function SessionDetail({ analysisId, onClose }: { analysisId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/backend/analyses/${encodeURIComponent(analysisId)}`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Could not load this session.');
        if (active) setDetail(result as AnalysisDetail);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load this session.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [analysisId]);

  return (
    <section className="session-detail" aria-label="Saved session details">
      <div className="session-detail-heading"><div><p className="eyebrow">SAVED SESSION</p><h2>Rep review</h2></div><button type="button" onClick={onClose}>Close</button></div>
      {loading && <p>Loading saved rep details…</p>}
      {error && <p role="alert" className="error-banner">{error}</p>}
      {detail && <>
        <div className="session-detail-summary"><span>{detail.exercise} · {detail.source}</span><span>{new Date(detail.created_at).toLocaleString()}</span><strong>{detail.score}% within range</strong><span>{detail.correct_reps} within range · {detail.incorrect_reps} outside · {detail.total_reps} reps</span></div>
        <p className="session-detail-model">Assessment version: {detail.model_version}</p>
        {Object.keys(detail.constraints_snapshot ?? {}).length > 0 && <><h3 className="session-plan-title">Plan recorded for this session</h3><dl className="session-plan-snapshot">{Object.entries(detail.constraints_snapshot).map(([key, value]) => <div key={key}><dt>{titleFor(key)}</dt><dd>{value === null || value === undefined ? 'Not set' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></>}
        {detail.warnings.length > 0 && <ul className="session-detail-warnings">{detail.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
        {detail.reps.length === 0 ? <p>No per-rep details were saved for this session.</p> : <div className="session-detail-reps">{detail.reps.map((rep) => <article key={rep.rep}>
          <header><h3>Rep {rep.rep}</h3><b className={`session-status status-${rep.status}`}>{titleFor(rep.status)}</b></header>
          <p className="session-time">Start {rep.start_s.toFixed(1)}s · bottom {rep.bottom_s.toFixed(1)}s · end {rep.end_s.toFixed(1)}s</p>
          <h4>Measurements</h4>
          {Object.keys(rep.measurements ?? {}).length ? <dl>{Object.entries(rep.measurements).map(([key, value]) => <div key={key}><dt>{titleFor(key)}</dt><dd>{measurementValue(value)}</dd></div>)}</dl> : <p>No measurements were saved.</p>}
          {rep.issues?.length > 0 && <><h4>What was flagged</h4><ul>{rep.issues.map((issue, index) => <li key={index}>{typeof issue === 'string' ? issue : issue.message ?? issue.code ?? 'Movement issue'}</li>)}</ul></>}
          {rep.advice?.some((cue) => cue.source !== 'recent_sessions_and_therapist_plan') && <><h4>For this rep</h4><ul>{rep.advice.filter((cue) => cue.source !== 'recent_sessions_and_therapist_plan').map((cue, index) => <li key={`${cue.code ?? 'cue'}-${index}`}>{cue.message}</li>)}</ul></>}
          {rep.advice?.some((cue) => cue.source === 'recent_sessions_and_therapist_plan') && <><h4>Repeated pattern across recent sessions</h4><ul>{rep.advice.filter((cue) => cue.source === 'recent_sessions_and_therapist_plan').map((cue, index) => <li key={`${cue.code ?? 'trend'}-${index}`}>{cue.message}</li>)}</ul></>}
          {rep.ml && <p className="session-detail-model">Model advisory: {String(rep.ml.prediction ?? rep.ml.label ?? 'available')}{rep.ml.confidence !== undefined ? ` · ${(Number(rep.ml.confidence) * 100).toFixed(0)}% confidence` : ''}. Not a clinical verdict.</p>}
        </article>)}</div>}
        <p className="session-detail-disclaimer">These saved measurements and cues are movement feedback based on the session’s recorded plan. They are not a medical diagnosis.</p>
      </>}
    </section>
  );
}
