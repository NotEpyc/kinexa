import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ available: false, reason: 'Invalid assessment request.' }, { status: 400 });
  }

  const backendUrl = (process.env.KINEXA_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  try {
    const response = await fetch(`${backendUrl}/api/quality/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    const result = await response.json();
    return NextResponse.json(result, { status: response.status });
  } catch {
    return NextResponse.json(
      { available: false, reason: 'Quality model service is unavailable. ROM feedback remains active.' },
      { status: 503 },
    );
  }
}
