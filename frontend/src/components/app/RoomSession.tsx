import { Suspense } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useRoomConnection } from '@/lib/socket/client';

/** Keep synchronization alive while the gate switches between lobby and table. */
export function RoomSession() {
  useRoomConnection(useParams().code ?? null);
  return <Suspense fallback={<div role="status" className="p-6">AVALON…</div>}><Outlet /></Suspense>;
}
