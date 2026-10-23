import { afterEach, expect, it, vi } from 'vitest';
import { roomHarness } from './test-room';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('persists private consent across room recreation and authorizes votes from the socket identity', async () => {
  const h = roomHarness();
  await h.action(h.host, 'room:start');
  await h.ackRoles();
  const reds = h.sockets.filter((s) => s !== h.spectator && s.game.canStartAssassination);
  const initiator = reds.find((s) => s.game.selfRole !== 'Assassin')!;
  const assassin = reds.find((s) => s.game.selfRole === 'Assassin')!;
  expect((await h.action(initiator, 'game:startAssassination')).ok).toBe(true);
  const ballot = initiator.game.earlyAssassination!;
  expect(initiator.game.phase).toBe('TeamBuilding');
  expect(h.spectator.game.earlyAssassination).toBeUndefined();
  expect((await h.action(h.spectator, 'game:voteAssassination', { proposalId: ballot.id, value: 'approve', by: assassin.deserializeAttachment().playerId, admin: true })).ok).toBe(false);
  h.wake();
  const assassinId = assassin.deserializeAttachment().playerId!;
  await h.action(assassin, 'room:join', { playerId: assassinId, playerToken: h.document.sessions[assassinId] });
  expect(assassin.game.earlyAssassination).toEqual(ballot);
  expect((await h.action(assassin, 'game:voteAssassination', { proposalId: ballot.id, value: 'approve' })).ok).toBe(true);
  expect(assassin.game.phase).toBe('Assassination');
  expect(assassin.game.earlyAssassination).toBeUndefined();
});

it('lets a known bot teammate consent without exposing a public action timer', async () => {
  vi.useFakeTimers();
  const h = roomHarness();
  await h.action(h.host, 'room:start');
  await h.ackRoles();
  const reds = h.sockets.filter((s) => s !== h.spectator && s.game.canStartAssassination);
  const [human, bot] = reds;
  const botId = bot!.deserializeAttachment().playerId!;
  h.document.members.find((m) => m.id === botId)!.isBot = true;
  h.wake();
  const humanId = human!.deserializeAttachment().playerId!;
  await h.action(human!, 'room:join', { playerId: humanId, playerToken: h.document.sessions[humanId] });
  expect((await h.action(human!, 'game:startAssassination')).ok).toBe(true);
  expect(h.document.game!.earlyAssassination?.votes[botId]).toBeUndefined();
  expect(human!.game.actionTimers?.some((timer) => timer.action.includes('assassination'))).toBe(false);
  await vi.advanceTimersByTimeAsync(1_999);
  expect(h.document.game!.earlyAssassination?.votes[botId]).toBeUndefined();
  await h.action(human!, 'net:ping');
  await vi.advanceTimersByTimeAsync(1);
  expect(h.document.game!.earlyAssassination).toBeNull();
  expect(h.document.game!.phase).toBe('Assassination');
  vi.clearAllTimers();
});
