import { NextResponse } from 'next/server';

export async function GET() {
  const backendUrl = (process.env.KINEXA_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  try {
    const response = await fetch(`${backendUrl}/api/quality/exercises`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    const result = await response.json();
    return NextResponse.json(result, { status: response.status });
  } catch {
    return NextResponse.json({ exercises: [], reason: 'Quality model service is unavailable.' }, { status: 503 });
  }
}
