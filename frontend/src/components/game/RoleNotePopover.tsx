import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'use-intl';
import type { ClientPlayer } from '@/lib/engine';
import { roleNoteTone, type RoleNote } from '@/lib/game/roleNotes';
import { useRoleText } from '@/lib/game/useRoleText';

export function RoleNotePopover({
  id,
  anchor,
  player,
  options,
  defaultNote,
  hasManualNote,
  note,
  onChange,
  onClose,
  saveFailed,
}: {
  id: string;
  anchor: HTMLButtonElement;
  player: ClientPlayer;
  options: RoleNote[];
  defaultNote?: RoleNote;
  hasManualNote: boolean;
  note?: RoleNote;
  onChange: (note: RoleNote | null) => void;
  onClose: () => void;
  saveFailed: boolean;
}) {
  const t = useTranslations('roleNotes');
  const roleText = useRoleText();
  const choices = options.filter(
    (value): value is Exclude<RoleNote, 'merlin-or-morgana'> =>
      value !== 'merlin-or-morgana',
  );
  const choiceCount = choices.length + (hasManualNote ? 1 : 0);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const popover = ref.current!;
    function position() {
      const rect = anchor.getBoundingClientRect();
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const viewport = window.visualViewport;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const left = Math.max(
        viewportLeft + 8,
        Math.min(
          rect.left + rect.width / 2 - width / 2,
          viewportLeft + viewportWidth - width - 8,
        ),
      );
      const below = rect.bottom + 8;
      const top =
        below + height <= viewportTop + viewportHeight - 8
          ? below
          : rect.top - height - 8;
      popover.style.left = `${left}px`;
      popover.style.top = `${Math.max(viewportTop + 8, Math.min(top, viewportTop + viewportHeight - height - 8))}px`;
    }
    popover.showPopover();
    position();
    (
      popover.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      popover.querySelector<HTMLButtonElement>('.role-note-option')
    )?.focus({ preventScroll: true });
    const resize = new ResizeObserver(position);
    resize.observe(popover);
    resize.observe(anchor);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      popover.hidePopover();
    };
  }, [anchor]);
  return createPortal(
    <div
      ref={ref}
      id={id}
      popover="auto"
      role="dialog"
      tabIndex={-1}
      aria-label={t('title')}
      aria-describedby={`${id}-player`}
      className="role-note-popover"
      style={{
        width: `min(${Math.min(236, Math.max(1, choiceCount) * 56 + 16)}px, calc(100vw - 16px))`,
      }}
      onToggle={(event) => {
        if (event.newState === 'closed') onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          anchor.focus({ preventScroll: true });
        }
      }}
    >
      <span id={`${id}-player`} className="sr-only">
        {player.seat + 1}. {player.name}
      </span>
      {saveFailed && (
        <p role="alert" className="mb-2 text-xs text-amber-300">
          {t('saveFailed')}
        </p>
      )}
      <div className="role-note-choices">
        {choices.map((value) => (
          <button
            key={value}
            type="button"
            className="role-note-option"
            data-team={roleNoteTone(value)}
            aria-pressed={note === value}
            onClick={() => onChange(value)}
          >
            {value === 'percival-claim' ? t('percivalClaim') : value === 'good' || value === 'evil'
              ? roleText.teamLabel(value)
              : roleText.shortName(value)}
          </button>
        ))}
        {hasManualNote && (
          <button
            type="button"
            className="role-note-option role-note-clear"
            aria-label={t(defaultNote ? 'resetKnown' : 'clear')}
            onClick={() => onChange(null)}
          >
            {t(defaultNote ? 'resetShort' : 'unknown')}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
