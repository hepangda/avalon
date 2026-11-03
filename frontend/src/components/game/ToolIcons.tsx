import { cn } from '@/lib/utils/cn';
import { GameIcon, type GameIconName } from './GameArt';

/** Line glyphs for table tools, drawn on one 24px grid so the sheet reads as a set. */
const GLYPHS = {
  fullscreen: 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6',
  exitFullscreen: 'M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6',
  notes: 'M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8.5-8.5 8.5zM8 8h.01',
  clearNotes: 'M14.5 4.5l5 5-9.5 9.5H5.5l-2-2a1.4 1.4 0 0 1 0-2zM9 10l5 5M11 19h9',
  alerts: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2.2 2.2 0 0 0 4 0M12 3v2',
  pause: 'M9 5v14M15 5v14',
  resume: 'M8 5.5v13l10.5-6.5z',
  skip: 'M5 6l8 6-8 6zM18 6v12',
  reroll: 'M19.5 10A8 8 0 0 0 5.2 7.5M4.5 14a8 8 0 0 0 14.3 2.5M5 3v4.5h4.5M19 21v-4.5h-4.5',
  vote: 'M4.5 4.5h15v15h-15zM8.5 12l2.5 2.5 4.5-5',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  retractVotes: 'M4 13h16v7H4zM12 3v7M9 6l3-3 3 3',
  retractProposal: 'M6 3.5h12v17H6zM9.5 9.5l5 5M14.5 9.5l-5 5',
  unbind: 'M11 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3.5 21a7.5 7.5 0 0 1 11-6.6M16.5 16.5l4 4M20.5 16.5l-4 4',
  referee: 'M12 4v16M8 20h8M5 7h14M12 4a1.5 1.5 0 1 0 0 .01M5 7l-3 6.5a3 3 0 0 0 6 0zM19 7l-3 6.5a3 3 0 0 0 6 0z',
  leave: 'M13 4H5.5v16H13M13 4l6 2v12l-6 2zM15.5 12h.01',
} as const;

export type ToolGlyph = keyof typeof GLYPHS;
export type ToolArt = { glyph: ToolGlyph } | { emblem: GameIconName };

export function ToolIcon({ art, className }: { art: ToolArt; className?: string }) {
  if ('emblem' in art) return <GameIcon name={art.emblem} className={cn('fx-emblem', className)} />;
  return (
    <svg viewBox="0 0 24 24" className={cn('fx-glyph', className)} fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPHS[art.glyph]} />
    </svg>
  );
}
