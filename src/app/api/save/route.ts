import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/** GET /api/save — list all saves */
export async function GET() {
  try {
    const saves = await db.gameSave.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, seed: true, tick: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json(saves);
  } catch (e) {
    console.error('Failed to list saves:', e);
    return NextResponse.json({ error: 'Failed to list saves' }, { status: 500 });
  }
}

/** POST /api/save — create a new save */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, seed, settings, state, tick } = body;

    const save = await db.gameSave.create({
      data: {
        name: name ?? `Save ${Date.now()}`,
        seed: seed ?? 42,
        settings: typeof settings === 'string' ? settings : JSON.stringify(settings ?? {}),
        state: typeof state === 'string' ? state : JSON.stringify(state ?? {}),
        tick: tick ?? 0,
      },
    });

    return NextResponse.json(save);
  } catch (e) {
    console.error('Failed to create save:', e);
    return NextResponse.json({ error: 'Failed to create save' }, { status: 500 });
  }
}
