import { NextResponse } from 'next/server';
import { createRoom } from '@/lib/socket/server';
import type { RoomConfig } from '@/lib/socket/types';

export const dynamic = 'force-dynamic';

interface CreateBody {
  roster?: string[];
  config?: Partial<RoomConfig>;
}

export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const roster = Array.isArray(body.roster) ? body.roster : [];

  try {
    const { code, hostToken } = await createRoom({
      roster,
      config: body.config,
    });
    return NextResponse.json({ code, hostToken }, { status: 201 });
  } catch (e) {
    console.error('[POST /api/rooms] failed', e);
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}
