/**
 * Integration smoke test: drives a full 5-player Avalon game over Socket.IO
 * against the running server + Neon DB. Not a unit test — a live end-to-end
 * check. Run with: npx tsx scripts/smoke.ts  (server must be running on PORT)
 */
import { io, type Socket } from 'socket.io-client';

const PORT = process.env.PORT ?? '3100';
const URL = `http://localhost:${PORT}`;

interface Ack<T = unknown> {
  ok: boolean;
  error?: { code: string; message: string };
  data?: T;
}

function connect(): Socket {
  return io(URL, { path: '/socket.io', transports: ['websocket'] });
}

function emit<T = unknown>(s: Socket, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => {
    s.emit(event, payload, (r: Ack<T>) => resolve(r));
  });
}

function waitConnect(s: Socket): Promise<void> {
  return new Promise((resolve) => s.on('connect', () => resolve()));
}

const log = (...a: unknown[]) => console.log(...a);
let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) log(`  ✓ ${msg}`);
  else {
    log(`  ✗ FAIL: ${msg}`);
    failures++;
  }
}

async function main() {
  // 1. Create a room via REST.
  const createRes = await fetch(`${URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostName: 'Host', config: { options: { ladyOfTheLake: true } } }),
  });
  const { code, hostPlayerId } = (await createRes.json()) as {
    code: string;
    hostPlayerId: string;
  };
  log(`Created room ${code}, host ${hostPlayerId}`);

  // 2. Five sockets join. The host reconnects with its existing playerId.
  const sockets: Socket[] = [];
  const playerIds: string[] = [];
  const latestState: Record<number, import('../src/lib/engine').ClientGameState> = {};
  const reveals: Record<number, { selfRole: string; knownPlayers: unknown[] }> = {};

  for (let i = 0; i < 5; i++) {
    const s = connect();
    await waitConnect(s);
    s.on('state:sync', (st) => {
      latestState[i] = st;
    });
    s.on('private:reveal', (r) => {
      reveals[i] = r;
    });
    const joinRes = await emit<{ playerId: string }>(s, 'room:join', {
      code,
      playerId: i === 0 ? hostPlayerId : undefined,
      name: `P${i}`,
    });
    assert(joinRes.ok, `player ${i} joined`);
    playerIds[i] = joinRes.data!.playerId;
    sockets.push(s);
  }
  assert(playerIds[0] === hostPlayerId, 'host kept its playerId on reconnect');

  // 3. Host starts the game.
  const startRes = await emit(sockets[0]!, 'room:start', {});
  assert(startRes.ok, 'host started the game');
  await sleep(400);

  assert(Object.keys(reveals).length === 5, 'all 5 players received a private reveal');
  // Security: no client state leaks other players' roles.
  const st0 = latestState[0]!;
  const othersWithRole = st0.players.filter((p) => p.role !== undefined && p.id !== playerIds[0]);
  assert(othersWithRole.length === 0, 'no other roles leaked in state:sync');
  assert(st0.phase === 'RoleReveal', 'phase is RoleReveal after start');

  // 4. All ack their role → TeamBuilding.
  for (const s of sockets) await emit(s, 'game:ackRole', {});
  await sleep(300);
  assert(latestState[0]!.phase === 'TeamBuilding', 'advanced to TeamBuilding after all acks');

  // 5. Play a full game: helper finds the leader, proposes, votes, missions.
  const roleById = new Map<string, string>();
  // Reconstruct roles from reveals + own role for assertions/strategy.
  for (let i = 0; i < 5; i++) {
    const st = latestState[i]!;
    const me = st.players.find((p) => p.id === playerIds[i]);
    if (me?.role) roleById.set(playerIds[i]!, me.role);
  }
  assert(roleById.size === 5, 'reconstructed all 5 self-roles');

  let safety = 0;
  while (safety++ < 30) {
    const st = latestState[0]!;
    if (st.phase === 'GameOver' || st.phase === 'Assassination') break;

    if (st.phase === 'TeamBuilding') {
      const leaderId = st.players.find((p) => p.seat === st.leaderIndex)!.id;
      const leaderIdx = playerIds.indexOf(leaderId);
      const size = st.config.missionSizes[st.roundIndex]!;
      const team = st.players.slice(0, size).map((p) => p.id);
      const r = await emit(sockets[leaderIdx]!, 'game:proposeTeam', { team });
      assert(r.ok, `leader proposed team of ${size} (mission ${st.roundIndex + 1})`);
      await sleep(150);
    } else if (st.phase === 'Voting') {
      for (const s of sockets) await emit(s, 'game:vote', { value: 'approve' });
      await sleep(200);
    } else if (st.phase === 'MissionVote') {
      const team = st.proposedTeam!;
      for (const pid of team) {
        const idx = playerIds.indexOf(pid);
        const role = roleById.get(pid)!;
        const isEvil = ['Morgana', 'Assassin', 'Oberon', 'Mordred', 'Minion'].includes(role);
        // Evil fails when possible to push the game forward; good must succeed.
        await emit(sockets[idx]!, 'game:missionCard', { card: isEvil ? 'fail' : 'success' });
      }
      await sleep(250);
    } else if (st.phase === 'LadyOfLake') {
      const holderId = st.lady!.holderId!;
      const idx = playerIds.indexOf(holderId);
      const target = st.players.find((p) => p.id !== holderId && !st.lady!.inspectedIds.includes(p.id))!;
      const r = await emit(sockets[idx]!, 'game:useLady', { targetPlayerId: target.id });
      assert(r.ok, 'lady inspection performed');
      await sleep(200);
    } else {
      await sleep(150);
    }
  }

  const finalPhase = latestState[0]!.phase;
  log(`Reached phase: ${finalPhase} after ${safety} steps`);
  assert(
    finalPhase === 'GameOver' || finalPhase === 'Assassination',
    'game reached a terminal-ish phase',
  );

  // 6. If assassination, the assassin fires at Merlin.
  if (finalPhase === 'Assassination') {
    const assassinPid = [...roleById.entries()].find(([, r]) => r === 'Assassin')![0];
    const merlinPid = [...roleById.entries()].find(([, r]) => r === 'Merlin')![0];
    const idx = playerIds.indexOf(assassinPid);
    const r = await emit(sockets[idx]!, 'game:assassinate', { targetPlayerId: merlinPid });
    assert(r.ok, 'assassin fired at Merlin');
    await sleep(300);
    assert(latestState[0]!.phase === 'GameOver', 'phase is GameOver after assassination');
  }

  // 7. Final reveal present for everyone.
  const finalState = latestState[0]!;
  assert(finalState.outcome !== null, 'outcome present at GameOver');
  assert(
    finalState.players.every((p) => p.role !== undefined),
    'all roles revealed at GameOver',
  );
  log(`Winner: ${finalState.outcome?.winner} (${finalState.outcome?.reason})`);

  // 8. Reconnect test: drop a player and rejoin with stored playerId.
  sockets[1]!.disconnect();
  await sleep(300);
  const s1b = connect();
  await waitConnect(s1b);
  let resyncState: unknown = null;
  s1b.on('state:sync', (st) => {
    resyncState = st;
  });
  const rejoin = await emit<{ playerId: string }>(s1b, 'room:join', {
    code,
    playerId: playerIds[1],
    name: 'P1',
  });
  assert(rejoin.ok && rejoin.data!.playerId === playerIds[1], 'player reconnected to same id');
  await sleep(400);
  assert(resyncState !== null, 'reconnected player received a state sync');

  for (const s of sockets) s.disconnect();
  s1b.disconnect();

  log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});
