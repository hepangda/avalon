import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { roomActions } from '@/lib/socket/client';
import { cn } from '@/lib/utils/cn';
import type { RoomDetails } from '@/lib/socket/types';

function VisibilityIcon({ value }: { value: RoomDetails['visibility'] }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
      {value === 'private'
        ? <path d="M6 9V7a4 4 0 1 1 8 0v2M5 9h10v8H5z" />
        : <path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm-7-7h14M10 3c2 2 2.8 4.4 2.8 7S12 15 10 17c-2-2-2.8-4.4-2.8-7S8 5 10 3Z" />}
    </svg>
  );
}

interface RoomTitleProps extends RoomDetails {
  code: string;
  isHost: boolean;
  disabled: boolean;
  onError: (message: string) => void;
}

/** Header title: the room name and its visibility, both edited in place by the host. */
export function RoomTitle({ code, name, visibility, isHost, disabled, onError }: RoomTitleProps) {
  const t = useTranslations();
  const [draft, setDraft] = useState({ name, visibility });
  const [editing, setEditing] = useState(false);
  const discard = useRef(false);
  useEffect(() => { setDraft({ name, visibility }); }, [name, visibility]);
  const shownName = draft.name || t('publicRooms.unnamed', { code });

  async function save(next: RoomDetails) {
    next = { ...next, name: next.name.trim() };
    setDraft(next);
    if (!isHost || disabled || (next.name === name && next.visibility === visibility)) return;
    try {
      const result = await roomActions.details(next);
      if (!result.ok) throw new Error(result.error?.message);
    } catch (e) {
      onError((e as Error).message || t('roomDetails.saveFailed'));
      setDraft({ name, visibility });
    }
  }

  const chip = (
    <>
      <VisibilityIcon value={draft.visibility} />
      <span className="sr-only">{t('roomDetails.visibility')}: </span>
      {t(`roomDetails.${draft.visibility}`)}
    </>
  );

  if (!isHost) {
    return (
      <div className="lobby-title">
        <h1 className="lobby-title-name"><span className="truncate">{shownName}</span></h1>
        <span className="lobby-title-chip">{chip}</span>
      </div>
    );
  }

  return (
    <div className="lobby-title">
      {editing ? (
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            event.currentTarget.querySelector('input')?.blur();
          }}
        >
          <input
            autoFocus
            value={draft.name}
            maxLength={40}
            placeholder={t('roomDetails.unnamed')}
            aria-label={t('roomDetails.name')}
            enterKeyHint="done"
            className="lobby-title-name lobby-title-input"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              discard.current = true;
              setDraft({ ...draft, name });
              event.currentTarget.blur();
            }}
            onBlur={() => {
              setEditing(false);
              if (discard.current) {
                discard.current = false;
                return;
              }
              void save(draft);
            }}
          />
        </form>
      ) : (
        <h1 className="min-w-0">
          <button
            type="button"
            className={cn('lobby-title-name', !draft.name && 'is-unnamed')}
            aria-label={`${t('roomDetails.name')}: ${shownName}`}
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            <span className="truncate">{shownName}</span>
          </button>
        </h1>
      )}
      <button
        type="button"
        className="lobby-title-chip"
        disabled={disabled}
        onClick={() => void save({ ...draft, visibility: draft.visibility === 'private' ? 'public' : 'private' })}
      >
        {chip}
      </button>
    </div>
  );
}
