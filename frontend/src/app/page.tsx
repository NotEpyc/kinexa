'use client';

import { FormEvent, useEffect, useState } from 'react';
import LiveSession from './live-session';
import SessionProgress, { type ProgressSession } from '@/components/session-progress';

type Account = { id: string; name: string; email: string; role: string; patient_id?: string | null };
type HistoryItem = ProgressSession;

function AccountControls({ label, onSignOut }: { label: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    try {
      const response = await fetch('/api/backend/auth/change-password', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Could not change password.');
      setMessage('Password updated.'); setCurrentPassword(''); setNewPassword('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change password.'); }
  };

  return <div className="account-controls"><div className="auth-session-bar"><span>{label}</span><button type="button" onClick={() => { setOpen(!open); setMessage(''); setError(''); }}>Change password</button><button type="button" onClick={onSignOut}>Sign out</button></div>{open && <form className="password-change" onSubmit={updatePassword}><label>Current password<input type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>New password (12+ characters)<input type="password" required minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><button type="submit">Update password</button>{message && <span role="status">{message}</span>}{error && <span role="alert">{error}</span>}</form>}</div>;
}

export default function Home() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    fetch('/api/backend/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Your session expired. Please sign in again.');
        setAccount(await response.json());
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Please sign in to continue.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (account?.role !== 'patient' || !account.patient_id) return;
    fetch(`/api/backend/patients/${encodeURIComponent(account.patient_id)}/analyses`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Could not load your session history.');
        setHistory(result);
      })
      .catch((reason: unknown) => setHistoryError(reason instanceof Error ? reason.message : 'Could not load history.'));
  }, [account]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const endpoint = register ? '/api/backend/auth/register/therapist' : '/api/backend/auth/login';
      const body = register ? { name, email, password } : { email, password };
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Could not sign in.');
      setAccount(result.user);
      setPassword('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authentication service is unavailable.');
    }
  };

  const signOut = () => {
    fetch('/api/backend/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .finally(() => setAccount(null));
  };

  if (account?.role === 'patient') return (
    <main className="patient-home">
      <AccountControls label={`Patient account · ${account.name}`} onSignOut={signOut} />
      <section className="patient-history"><p className="eyebrow">KINEXA · YOUR MOVEMENT HISTORY</p><h1>Welcome, {account.name}</h1><p className="lede">Your therapist’s prescribed plans and saved exercise sessions appear here.</p>
        {historyError && <p role="alert" className="error-banner">{historyError}</p>}
        {!historyError && history.length > 1 && <SessionProgress sessions={history} />}
        {!history.length && !historyError ? <p>No saved sessions yet.</p> : <ul>{history.map((item) => <li key={item.analysis_id}><span><b>{item.exercise}</b><small>{new Date(item.created_at).toLocaleString()}</small></span><span>{item.total_reps} reps</span><strong>{item.score}%</strong></li>)}</ul>}
      </section>
    </main>
  );

  if (loading) return <main className="auth-shell"><p>Checking your session…</p></main>;
  if (!account) return (
    <main className="auth-shell">
      <form className="auth-panel" onSubmit={submit}>
        <p className="eyebrow">KINEXA · THERAPIST PORTAL</p>
        <h1>{register ? 'Create therapist account' : 'Welcome back'}</h1>
        <p className="lede">Sign in to manage your patients and their exercise plans.</p>
        {register && <label>Your name<input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} /></label>}
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 12 : 1} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {register && <small>Use at least 12 characters. Store your password safely; account recovery is not available yet.</small>}
        {error && <p className="error-banner" role="alert">{error}</p>}
        <button className="button" type="submit">{register ? 'Create account' : 'Sign in'}<span aria-hidden="true">↗</span></button>
        <button className="auth-toggle" type="button" onClick={() => { setRegister(!register); setError(''); }}>
          {register ? 'Already have an account? Sign in' : 'New therapist? Create an account'}
        </button>
      </form>
    </main>
  );

  return account ? <><AccountControls label={`Signed in as ${account.name} · ${account.email}`} onSignOut={signOut} /><LiveSession /></> : null;
}
