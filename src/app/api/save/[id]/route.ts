import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/save/[id] — load a save */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const save = await db.gameSave.findUnique({ where: { id } });
    if (!save) {
      return NextResponse.json({ error: 'Save not found' }, { status: 404 });
    }
    return NextResponse.json(save);
  } catch (e) {
    console.error('Failed to load save:', e);
    return NextResponse.json({ error: 'Failed to load save' }, { status: 500 });
  }
}

/** DELETE /api/save/[id] — delete a save */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await db.gameSave.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Failed to delete save:', e);
    return NextResponse.json({ error: 'Failed to delete save' }, { status: 500 });
  }
}
