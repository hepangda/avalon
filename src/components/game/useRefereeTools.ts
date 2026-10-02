import type { ClientGameState } from '@/lib/engine';
import { seatLabel } from '@/lib/game/playerLabel';
import { adminActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';

type RefereeTool =
  | 'enable'
  | 'rerollLeader'
  | 'rerollRoles'
  | 'assassination'
  | 'previous'
  | 'skipSpeech'
  | 'pauseTimer'
  | 'resumeTimer'
  | 'unbind'
  | 'vote'
  | 'retractVotes'
  | 'retractProposal'
  | 'propose'
  | 'disable';

export function useRefereeTools(game: ClientGameState) {
  const t = useTranslations();
  const authed = useRoomStore((state) => state.isReferee);
  const [activeTool, setActiveTool] = useState<RefereeTool | null>(null);
  const [skipTarget, setSkipTarget] = useState<string | null>(null);
  const speakerId = game.phase === 'Discussion' ? game.discussion?.order[game.discussion.speakerIndex] : undefined;
  const speaker = game.players.find((p) => p.id === speakerId);
  const timersPaused = game.actionTimers?.some((timer) => timer.pausedAt !== undefined) ?? false;
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setActiveTool(null);
    setError(null);
    setVoteTarget('');
    setProposeSel([]);
  }, [game.phase, game.phaseRevision, speakerId, authed]);

  // Act-as-player target selection.
  const [voteTarget, setVoteTarget] = useState('');
  const [proposeSel, setProposeSel] = useState<string[]>([]);

  const players = game.players;
  const teamSize = game.config.missionSizes[game.roundIndex] ?? 0;

  // Admin can only cast a vote for players who haven't voted yet.
  const unvotedPlayers = players.filter(
    (p) => !game.votes?.find((v) => v.playerId === p.id)?.hasVoted,
  );

  const canStartAssassination = !['Assassination', 'GameOver', 'Lobby'].includes(game.phase);
  const entries: {
    id: RefereeTool;
    title: string;
    icon: string;
    disabled?: boolean;
  }[] = authed
      ? [
        ...(game.actionTimers?.length ? [{
          id: timersPaused ? 'resumeTimer' as const : 'pauseTimer' as const,
          title: t(timersPaused ? 'admin.resumeTimer' : 'admin.pauseTimer'),
          icon: timersPaused ? '▶' : 'Ⅱ',
        }] : []),
        ...(speaker ? [{ id: 'skipSpeech' as const, title: t('admin.skipSpeech', { name: seatLabel(speaker.seat, speaker.name) }), icon: '↪' }] : []),
        ...(game.canRerollOpening
          ? [
            { id: 'rerollLeader' as const, title: t('admin.rerollLeader'), icon: '♛' },
            { id: 'rerollRoles' as const, title: t('admin.rerollRoles'), icon: '↻' },
          ]
          : []),
        ...(canStartAssassination
          ? [
            {
              id: 'assassination' as const,
              title: t('admin.startAssassination'),
              icon: '⚔',
            },
          ]
          : []),
        {
          id: 'previous',
          title: t('admin.previousPhase'),
          icon: '↶',
          disabled: !game.previousPhase,
        },
        { id: 'unbind', title: t('admin.unbindTitle'), icon: '♙' },
        ...(game.phase === 'Voting'
          ? [
            { id: 'vote' as const, title: t('admin.voteTitle'), icon: '☑' },
            {
              id: 'retractVotes' as const,
              title: t('admin.retractVotesTitle'),
              icon: '↶',
            },
            {
              id: 'retractProposal' as const,
              title: t('admin.retractProposalTitle'),
              icon: '↶',
            },
          ]
          : []),
        ...((game.phase === 'TeamBuilding' || game.phase === 'TeamFinalizing')
          ? [
            {
              id: 'propose' as const,
              title: t('admin.proposeTitle'),
              icon: '♛',
            },
          ]
          : []),
        { id: 'disable', title: t('admin.close'), icon: '✕' },
      ]
      : [{ id: 'enable', title: t('admin.open'), icon: '🛠' }];
  const selectedEntry = entries.find((entry) => entry.id === activeTool && !entry.disabled &&
    (entry.id !== 'skipSpeech' || skipTarget === speakerId));

  async function run(
    fn: () => Promise<{
      ok: boolean;
      error?: { code?: string; message: string };
    }>,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        setActiveTool(null);
      } else {
        setError(res.error?.message ?? t('admin.actionFailed'));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : t('admin.actionFailed'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function handleAuth() {
    await run(async () => {
      const res = await adminActions.auth();
      return { ...res, ok: res.ok && !!res.data?.ok };
    });
  }

  async function handleDisable() {
    await run(async () => {
      const res = await adminActions.close();
      return res;
    });
  }

  function toggleProposeMember(id: string) {
    setProposeSel((sel) =>
      sel.includes(id) ? sel.filter((x) => x !== id) : sel.length < teamSize ? [...sel, id] : sel,
    );
  }

  return { authed, activeTool, setActiveTool, skipTarget, setSkipTarget, speakerId, busy, error, setError, voteTarget, setVoteTarget, proposeSel, setProposeSel, players, teamSize, unvotedPlayers, entries, selectedEntry, run, handleAuth, handleDisable, toggleProposeMember };
}
