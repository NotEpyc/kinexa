'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type ProgressSession = {
  analysis_id: string;
  exercise: string;
  source: string;
  score: number;
  total_reps: number;
  created_at: string;
};

export default function SessionProgress({ sessions }: { sessions: ProgressSession[] }) {
  const ordered = [...sessions].reverse();
  if (ordered.length < 2) return <p className="progress-empty">Save at least two sessions to see a progress trend.</p>;

  const points = ordered.map((session, index) => ({
    name: `Session ${index + 1}`,
    date: new Date(session.created_at).toLocaleDateString(),
    rate: session.score,
    reps: session.total_reps,
  }));

  return (
    <div className="progress-chart" role="img" aria-label="Within-range rate across saved sessions">
      <div className="progress-chart-heading"><b>Within-range rate</b><span>{points.length} saved sessions</span></div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
          <CartesianGrid stroke="#e8ece6" strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#7b8782' }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#7b8782' }} unit="%" />
          <Tooltip formatter={(value) => [`${value}%`, 'Within range']} labelFormatter={(label, payload) => payload?.[0] ? `${label} · ${payload[0].payload.date} · ${payload[0].payload.reps} reps` : label} />
          <Line type="monotone" dataKey="rate" stroke="#167c69" strokeWidth={2.5} dot={{ r: 3, fill: '#167c69' }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
      <small>Based on configured movement rules for each saved session; not a therapist-rated clinical score.</small>
    </div>
  );
}
