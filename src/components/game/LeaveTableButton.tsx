import { useTranslations } from 'use-intl';
import { useNavigate } from 'react-router-dom';
import { Popconfirm } from '@/components/ui/Popconfirm';
import { roomActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { useSessionStore } from '@/lib/store/session';
import { wouldDissolveRoom } from '@/lib/game/roomDissolution';
import type { Ack } from '@/lib/socket/types';

/** The way out sits at the head of the table, as in the room; mid-game it asks first, right on the arrow. */
export function LeaveTableButton({ code, busy, run }: {
  code: string;
  busy: boolean;
  run: (action: () => Promise<Ack<unknown>>) => Promise<boolean>;
}) {
  const t = useTranslations();
  const navigate = useNavigate();
  const snapshot = useRoomStore((state) => state.snapshot);
  const myPlayerId = useRoomStore((state) => state.myPlayerId);
  const isHost = useRoomStore((state) => state.isHost);
  const willDissolve = snapshot ? wouldDissolveRoom(snapshot, myPlayerId, isHost) : false;
  async function leave() {
    if (!await run(roomActions.leave)) return;
    useSessionStore.getState().setSession(code, { playerId: undefined, playerToken: undefined });
    useRoomStore.getState().reset();
    navigate('/');
  }
  return (
    <Popconfirm title={t(willDissolve ? 'common.dissolveRoomTitle' : 'game.leaveSeatAsk')}
      confirmLabel={t(willDissolve ? 'common.dissolveShort' : 'game.leaveShort')} disabled={busy} onConfirm={leave}>
      {(trigger) => (
        <button {...trigger} type="button" className="table-tool -ml-2.5 shrink-0"
          aria-label={t('game.leaveSeat')} title={t('game.leaveSeat')}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 5-7 7 7 7M5 12h14" />
          </svg>
        </button>
      )}
    </Popconfirm>
  );
}
