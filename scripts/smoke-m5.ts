/**
 * M5 feature smoke test: rename, duplicate-name rejection, random default
 * names, and spectator redaction. Run against a running server + DB:
 *   PORT=3100 npx tsx scripts/smoke-m5.ts
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

async function main() {
  // Create room with a BLANK host name → server must assign a random name.
  const res = await fetch(`${URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostName: '' }),
  });
  const { code, hostPlayerId } = (await res.json()) as { code: string; hostPlayerId: string };

  const sockets: Socket[] = [];
  const snapshots: Record<number, { members: Array<{ id: string; name: string }> }> = {};

  for (let i = 0; i < 3; i++) {
    const s = connect();
    await waitConnect(s);
    s.on('room:snapshot', (snap) => {
      snapshots[i] = snap;
    });
    const join = await emit<{ playerId: string }>(s, 'room:join', {
      code,
      playerId: i === 0 ? hostPlayerId : undefined,
      name: i === 0 ? '' : 'Knight', // players 1 & 2 both request "Knight"
    });
    assert(join.ok, `player ${i} joined`);
    sockets.push(s);
    await sleep(150);
  }
  await sleep(300);

  const members = snapshots[0]!.members;
  const names = members.map((m) => m.name);
  console.log('  names:', names.join(', '));

  // Default name is never the literal "Player".
  assert(
    !names.some((n) => n === 'Player' || n.startsWith('Player')),
    'no default name is "Player"',
  );
  // Host (blank requested) got a non-empty random name.
  const hostMember = members.find((m) => m.id === hostPlayerId)!;
  assert(!!hostMember.name && hostMember.name.length > 0, 'host got a generated name');
  // The two "Knight" requests resolved to unique names (no exact duplicates).
  const uniqueCount = new Set(names.map((n) => n.toLowerCase())).size;
  assert(uniqueCount === names.length, 'all names are unique (duplicate auto-resolved)');

  // Explicit rename to a free name succeeds.
  const renameOk = await emit<{ name: string }>(sockets[1]!, 'room:rename', { name: 'Lancelot' });
  assert(renameOk.ok && renameOk.data?.name === 'Lancelot', 'rename to free name succeeds');
  await sleep(200);

  // Rename to a taken name is rejected.
  const takenName = members.find((m) => m.id !== hostPlayerId)!.name;
  const renameDup = await emit(sockets[0]!, 'room:rename', { name: 'Lancelot' });
  assert(!renameDup.ok && renameDup.error?.code === 'NAME_TAKEN', 'duplicate rename rejected');

  // Empty rename rejected.
  const renameEmpty = await emit(sockets[0]!, 'room:rename', { name: '   ' });
  assert(!renameEmpty.ok && renameEmpty.error?.code === 'INVALID_NAME', 'empty rename rejected');
  void takenName;

  // Spectator join: sees public info, no roles after game starts.
  // Need 5 players to start, so add two more, then a spectator.
  for (let i = 3; i < 5; i++) {
    const s = connect();
    await waitConnect(s);
    await emit(s, 'room:join', { code, name: `Extra${i}` });
    sockets.push(s);
    await sleep(120);
  }
  const spec = connect();
  await waitConnect(spec);
  interface SpecState {
    isSpectator?: boolean;
    selfRole?: unknown;
    players?: Array<{ role?: unknown }>;
  }
  let specState: SpecState | null = null;
  spec.on('state:sync', (st: SpecState) => {
    specState = st;
  });
  const specJoin = await emit(spec, 'room:join', { code, name: 'Watcher', asSpectator: true });
  assert(specJoin.ok, 'spectator joined');
  await sleep(200);

  const startRes = await emit(sockets[0]!, 'room:start', {});
  assert(startRes.ok, 'game started with 5 seated players');
  await sleep(500);

  const captured = specState as SpecState | null;
  assert(captured !== null, 'spectator received state sync');
  if (captured) {
    assert(captured.isSpectator === true, 'spectator flagged isSpectator');
    assert(
      captured.selfRole === null || captured.selfRole === undefined,
      'spectator has no role',
    );
    const anyRole = (captured.players ?? []).some((p) => p.role !== undefined);
    assert(!anyRole, 'spectator sees no player roles');
  }

  for (const s of sockets) s.disconnect();
  spec.disconnect();

  console.log(`\n${failures === 0 ? '✅ M5 CHECKS PASSED' : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('crashed', e);
  process.exit(1);
});
