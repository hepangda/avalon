import { useRef, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils/cn';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { GameIcon } from './GameArt';
import { latencyDotClass } from '@/lib/utils/latency';
import {
  arrangeSeats,
  type TablePresentation,
} from '@/lib/game/tablePresentation';
import { MissionTableReveal } from './MissionTableReveal';
import { LadyTokenFlight } from './LadyTokenFlight';
import { TableCard } from './TableCard';
import type { ActionTimer, ClientPlayer } from '@/lib/engine';
import { SeatTimer } from './SeatTimer';
import { roleNoteTone, type RoleNotes } from '@/lib/game/roleNotes';
import { useRoleText } from '@/lib/game/useRoleText';
import { seatShortcut } from '@/lib/game/tableShortcuts';

interface GameTableProps {
  players: ClientPlayer[];
  myPlayerId: string | null;
  selectable?: boolean;
  selectedIds?: string[];
  onToggle?: (id: string) => void;
  candidateIds?: string[];
  dimNonCandidates?: boolean;
  highlightIds?: string[];
  board: ReactNode;
  card?: (player: ClientPlayer) => ReactNode;
  seatTimer?: (player: ClientPlayer) => ActionTimer | undefined;
  now?: number;
  speakerId?: string;
  missionReveal?: Extract<TablePresentation, { kind: 'mission' }> | null;
  ladyFlight?: Extract<TablePresentation, { kind: 'lady' }> | null;
  onRevealComplete?: (id: string) => void;
  roleNotes?: RoleNotes;
  knownNotes?: RoleNotes;
  editableNoteIds?: string[];
  onEditRoleNote?: (id: string, anchor: HTMLButtonElement) => void;
  notePlayerId?: string;
  notePopoverId?: string;
}

/** Full-height match table. Player avatars straddle the two table edges. */
export function GameTable({
  players,
  myPlayerId,
  selectable = false,
  selectedIds = [],
  onToggle,
  candidateIds,
  dimNonCandidates = true,
  highlightIds = [],
  board,
  card,
  seatTimer,
  now = Date.now(),
  speakerId,
  missionReveal,
  ladyFlight,
  onRevealComplete,
  roleNotes = {},
  knownNotes = {},
  editableNoteIds,
  onEditRoleNote,
  notePlayerId,
  notePopoverId,
}: GameTableProps) {
  const t = useTranslations();
  const roleText = useRoleText();
  const root = useRef<HTMLDivElement>(null);
  const { top, bottom } = arrangeSeats(players, myPlayerId);
  const renderSeat = (p: ClientPlayer) => {
    const candidate = !candidateIds || candidateIds.includes(p.id);
    const canSelect = selectable && candidate && !!onToggle;
    const selected = selectedIds.includes(p.id);
    const isMe = p.id === myPlayerId;
    const connected = p.claimed !== false && p.connected;
    const note = roleNotes[p.id];
    const isKnownNote = !!note && knownNotes[p.id] === note;
    const noteLabel = note
      ? note === 'merlin-or-morgana' ? t('roleNotes.merlinOrMorganaShort')
        : note === 'percival-claim' ? t('roleNotes.percivalClaim')
        : note === 'good' || note === 'evil' ? roleText.teamShort(note) : roleText.shortName(note)
      : t('roleNotes.unknown');
    const noteTeam = note ? roleNoteTone(note) : undefined;
    // Notes are edited from the tag under each portrait, so a tap on a face never opens them by accident.
    const canNote = !!onEditRoleNote && !isMe && !!editableNoteIds?.includes(p.id);
    const timer = seatTimer?.(p);
    const noteAria = t('roleNotes.editPlayer', { seat: p.seat + 1, name: p.name, note: noteLabel });
    return (
      <div key={p.id} className="table-player" data-speaking={speakerId === p.id}>
        <div className="table-seat-wrap">
          <button
            type="button"
            className={cn(
              'table-seat',
              dimNonCandidates && selectable && !candidate && 'is-dimmed',
            )}
            disabled={!canSelect}
            aria-keyshortcuts={canSelect ? seatShortcut(p.seat) : undefined}
            aria-pressed={selectable ? selected : undefined}
            aria-label={`${p.seat + 1}. ${p.name}${isMe ? ` · ${t('common.you')}` : ''}`}
            onClick={() => { if (canSelect) onToggle?.(p.id); }}
          >
            <PlayerAvatar
              playerId={p.id}
              avatarUrl={p.claimed === false ? undefined : p.avatarUrl}
              name={p.name}
              empty={p.claimed === false}
              className={cn(
                'table-seat-number',
                isMe && 'is-mine',
                selected && 'is-selected',
                highlightIds.includes(p.id) && 'is-highlighted',
                p.claimed === false && 'is-empty',
                !connected && p.claimed !== false && 'is-away',
              )}
            >
              {timer && <SeatTimer timer={timer} now={now} />}
              {p.isLeader && (
                <GameIcon
                  name="leader"
                  className="table-leader-icon"
                  title={t('table.leader')}
                />
              )}
              {(p.isLadyHolder || p.id === ladyFlight?.holderId) && (
                <GameIcon
                  name="lady"
                  className="table-lady-icon"
                  title={t('lady.title')}
                  data-lady-icon={p.id}
                  // Both ends stay measurable while the token is in the air.
                  style={ladyFlight ? { visibility: 'hidden' } : undefined}
                />
              )}
              <span className="seat-number-tag" aria-hidden="true">{p.seat + 1}</span>
              <span
                className={`player-connection-dot ${latencyDotClass(connected, p.latency)}`}
                title={connected && p.latency !== undefined ? `${p.latency} ms` : t(
                  p.claimed === false
                    ? 'seat.empty'
                    : connected
                      ? 'seat.online'
                      : 'seat.offline',
                )}
              />
            </PlayerAvatar>
            <span
              className={cn(
                'table-seat-name',
                isMe && 'is-mine',
                p.isLeader && 'is-leader',
              )}
            >
              {p.name}
            </span>
            <span className="table-seat-meta" aria-hidden="true" />
          </button>
          {/* With notes on, every seat carries its tag, unknown until the player marks it. */}
          {onEditRoleNote && <div className="table-seat-labels">
            {canNote ? (
              <button
                type="button"
                className="table-role-note"
                data-team={noteTeam}
                data-fixed={isKnownNote || undefined}
                aria-label={noteAria}
                aria-haspopup="dialog"
                aria-expanded={notePlayerId === p.id}
                aria-controls={notePlayerId === p.id ? notePopoverId : undefined}
                title={t('roleNotes.privateLabel', { note: note === 'merlin-or-morgana' ? t('roleNotes.merlinOrMorgana') : noteLabel })}
                onClick={(event) => onEditRoleNote(p.id, event.currentTarget)}
              >
                {noteLabel}
              </button>
            ) : (
              <span className="table-role-note" data-team={noteTeam} data-fixed={isKnownNote || undefined}>{noteLabel}</span>
            )}
          </div>}
        </div>
        <div
          className="table-personal-zone"
          data-seat-card={p.id}
          style={
            missionReveal?.team.includes(p.id)
              ? { visibility: 'hidden' }
              : undefined
          }
          aria-label={t('table.playerCards', { seat: p.seat + 1 })}
          onClick={canSelect ? () => onToggle?.(p.id) : undefined}
        >
          {card?.(p) ?? <TableCard state="inactive" />}
        </div>
      </div>
    );
  };
  return (
    <div ref={root} className="game-table has-seat-labels">
      <div className="table-felt" aria-hidden="true">
        <GameIcon name="crest" className="table-felt-crest" />
      </div>
      <div
        className="table-end table-end-top"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, top.length)}, minmax(0, 1fr))`,
        }}
      >
        {top.map(renderSeat)}
      </div>
      <div className="table-center">{board}</div>
      <div
        className="table-end table-end-bottom"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, bottom.length)}, minmax(0, 1fr))`,
        }}
      >
        {bottom.map(renderSeat)}
      </div>
      {missionReveal && onRevealComplete && (
        <MissionTableReveal
          key={missionReveal.id}
          event={missionReveal}
          tableRef={root}
          onComplete={onRevealComplete}
        />
      )}
      {ladyFlight && onRevealComplete && (
        <LadyTokenFlight
          key={ladyFlight.id}
          event={ladyFlight}
          tableRef={root}
          onComplete={onRevealComplete}
        />
      )}
    </div>
  );
}
