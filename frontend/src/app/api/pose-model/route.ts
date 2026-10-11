import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const modelPath = path.resolve(process.cwd(), '..', 'backend', 'models', 'pose_landmarker_full.task');

  try {
    const model = await readFile(modelPath);
    return new NextResponse(model, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(model.byteLength),
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Pose model bundle is missing. Place pose_landmarker_full.task in backend/models/.' },
      { status: 503 },
    );
  }
}
