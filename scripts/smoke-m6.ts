/**
 * M6 replay smoke: play a full game, then fetch the replay API and validate
 * the data + MVP stats. Run against a running server + DB:
 *   PORT=3270 npx tsx scripts/smoke-m6.ts
 */
import { io, type Socket } from 'socket.io-client';
import { computeReplayStats } from '../src/lib/game/replayStats';
import type { ReplayData } from '../src/lib/game/replayTypes';

const PORT = process.env.PORT ?? '3270';
const URL = `http://localhost:${PORT}`;

interface Ack<T = unknown> {
  ok: boolean;
  error?: { code: string; message: string };
  data?: T;
}
function connect(): Socket {
  return io(URL, { path: '/socket.io', transports: ['websocket'] });
}
function emit<T = unknown>(s: Socket, e: string, p: unknown): Promise<Ack<T>> {
  return new Promise((res) => s.emit(e, p, (r: Ack<T>) => res(r)));
}
function waitConnect(s: Socket): Promise<void> {
  return new Promise((res) => s.on('connect', () => res()));
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`  ${cond ? '✓' : '✗ FAIL:'} ${msg}`);
  if (!cond) failures++;
}

const EVIL = ['Morgana', 'Assassin', 'Oberon', 'Mordred', 'Minion'];

async function main() {
  const createRes = await fetch(`${URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostName: 'Host', config: { options: { ladyOfTheLake: true } } }),
  });
  const { code, hostPlayerId } = (await createRes.json()) as {
    code: string;
    hostPlayerId: string;
  };

  const sockets: Socket[] = [];
  const playerIds: string[] = [];
  const latest: Record<number, import('../src/lib/engine').ClientGameState> = {};
  const roleById = new Map<string, string>();

  for (let i = 0; i < 5; i++) {
    const s = connect();
    await waitConnect(s);
    s.on('state:sync', (st) => {
      latest[i] = st;
    });
    const j = await emit<{ playerId: string }>(s, 'room:join', {
      code,
      playerId: i === 0 ? hostPlayerId : undefined,
      name: `P${i}`,
    });
    playerIds[i] = j.data!.playerId;
    sockets.push(s);
  }
  await emit(sockets[0]!, 'room:start', {});
  await sleep(400);
  for (const s of sockets) await emit(s, 'game:ackRole', {});
  await sleep(300);

  for (let i = 0; i < 5; i++) {
    const me = latest[i]!.players.find((p) => p.id === playerIds[i]);
    if (me?.role) roleById.set(playerIds[i]!, me.role);
  }

  let safety = 0;
  let capturedGameId: string | null = null;
  while (safety++ < 40) {
    const st = latest[0]!;
    if (st.gameId) capturedGameId = st.gameId;
    if (st.phase === 'GameOver') break;
    if (st.phase === 'TeamBuilding') {
      const leaderId = st.players.find((p) => p.seat === st.leaderIndex)!.id;
      const idx = playerIds.indexOf(leaderId);
      const size = st.config.missionSizes[st.roundIndex]!;
      await emit(sockets[idx]!, 'game:proposeTeam', {
        team: st.players.slice(0, size).map((p) => p.id),
      });
      await sleep(120);
    } else if (st.phase === 'Voting') {
      for (const s of sockets) await emit(s, 'game:vote', { value: 'approve' });
      await sleep(150);
    } else if (st.phase === 'MissionVote') {
      for (const pid of st.proposedTeam!) {
        const idx = playerIds.indexOf(pid);
        const evil = EVIL.includes(roleById.get(pid)!);
        await emit(sockets[idx]!, 'game:missionCard', { card: evil ? 'fail' : 'success' });
      }
      await sleep(200);
    } else if (st.phase === 'LadyOfLake') {
      const holderId = st.lady!.holderId!;
      const idx = playerIds.indexOf(holderId);
      const target = st.players.find(
        (p) => p.id !== holderId && !st.lady!.inspectedIds.includes(p.id),
      )!;
      await emit(sockets[idx]!, 'game:useLady', { targetPlayerId: target.id });
      await sleep(150);
    } else if (st.phase === 'Assassination') {
      const assassinPid = [...roleById.entries()].find(([, r]) => r === 'Assassin')![0];
      const merlinPid = [...roleById.entries()].find(([, r]) => r === 'Merlin')![0];
      const idx = playerIds.indexOf(assassinPid);
      await emit(sockets[idx]!, 'game:assassinate', { targetPlayerId: merlinPid });
      await sleep(250);
    } else {
      await sleep(120);
    }
  }

  assert(latest[0]!.phase === 'GameOver', 'reached GameOver');
  assert(!!capturedGameId, 'client received gameId via state:sync');
  assert(latest[0]!.gameId === capturedGameId, 'gameId present on final state');

  // Vote history: every completed proposal should be present in the client state.
  const vh = latest[0]!.voteHistory;
  assert(Array.isArray(vh) && vh.length >= 3, `voteHistory has entries (${vh?.length})`);
  assert(
    vh.every((v) => v.votes.length === 5),
    'each vote record lists all 5 players',
  );
  assert(
    vh.some((v) => v.approved),
    'at least one approved proposal in history',
  );

  // System logs: public visible to all, private only to the owner.
  const logs0 = latest[0]!.logs;
  const logs1 = latest[1]!.logs;
  assert(Array.isArray(logs0) && logs0.length > 0, `player 0 has logs (${logs0?.length})`);
  const pub0 = logs0.filter((l) => l.channel === 'public');
  const pub1 = logs1.filter((l) => l.channel === 'public');
  assert(pub0.length > 0, 'public logs present');
  assert(
    pub0.every((l) => typeof l.at === 'number' && l.at > 0),
    'every public log has a timestamp',
  );
  const voteLog = pub0.find((l) => l.key === 'voteApproved' || l.key === 'voteRejected');
  assert(
    !!voteLog && !!voteLog.params?.round && !!voteLog.params?.proposal,
    'vote logs carry round + proposal params',
  );
  assert(
    pub0.length === pub1.length && pub0.every((l, i) => l.key === pub1[i]!.key),
    'public log identical for all viewers',
  );
  assert(
    pub0.some((l) => l.key === 'gameStarted') && pub0.some((l) => l.key === 'teamProposed'),
    'public log contains game/round events',
  );
  // Private logs: each player has their own "yourRole" entry, never another's.
  const priv0 = logs0.filter((l) => l.channel === 'private');
  const priv1 = logs1.filter((l) => l.channel === 'private');
  assert(
    priv0.some((l) => l.key === 'yourRole') && priv1.some((l) => l.key === 'yourRole'),
    'each player has a private role entry',
  );
  const myRole0 = roleById.get(playerIds[0]!);
  const roleLog0 = priv0.find((l) => l.key === 'yourRole');
  assert(roleLog0?.params?.role === myRole0, "player 0's role log matches their actual role");
  // Player 0 must NOT see player 1's private entries (and vice-versa).
  assert(
    !logs0.some((l) => l.channel === 'private' && l.params?.role && l.params.role !== myRole0),
    'player 0 sees no other private role entries',
  );

  for (const s of sockets) s.disconnect();

  // Persistence is async — poll the replay API until the game is marked
  // finished (mirrors the client's retry-on-409 behaviour).
  let replayRes: Response | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(600);
    replayRes = await fetch(`${URL}/api/games/${capturedGameId}/replay`);
    if (replayRes.ok) break;
  }
  assert(!!replayRes && replayRes.ok, `replay API returns 200 (got ${replayRes?.status})`);
  const replay = (await replayRes!.json()) as ReplayData;

  assert(replay.gameId === capturedGameId, 'replay gameId matches');
  assert(replay.outcome !== null, 'replay has outcome');
  assert(replay.roleAssignments.length === 5, 'replay reveals all 5 roles');
  assert(replay.players.length === 5, 'replay lists all players');
  assert(replay.rounds.length >= 3, 'replay has at least 3 rounds');
  const playedRounds = replay.rounds.filter((r) => r.missionSuccess !== null);
  assert(playedRounds.length >= 3, 'at least 3 missions resolved');
  assert(
    playedRounds.every((r) => r.missionCards.length === (r.finalTeam ?? []).length),
    'each played round has a card per team member',
  );

  // Validate MVP stats compute without throwing and are in range.
  const stats = computeReplayStats(replay);
  assert(stats.players.length === 5, 'stats computed for 5 players');
  assert(!!stats.mvpPlayerId, 'an MVP was selected');
  const allInRange = stats.players.every(
    (p) =>
      (p.voteAccuracy === null || (p.voteAccuracy >= 0 && p.voteAccuracy <= 1)) &&
      p.missionParticipation >= 0 &&
      p.missionParticipation <= 1 &&
      (p.contribution === null || (p.contribution >= 0 && p.contribution <= 1)),
  );
  assert(allInRange, 'all stat values are within [0,1]');

  console.log(`\n${failures === 0 ? '✅ M6 CHECKS PASSED' : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('crashed', e);
  process.exit(1);
});
