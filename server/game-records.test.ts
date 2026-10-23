import { describe, expect, it } from 'vitest';
import app from './app';
import { accountKey } from './account-profile';
import { SESSION_COOKIE, sealSession } from './auth/session';
import type { Env } from './env';
import { historyGames, historyProfile, legacySeatLink, recordBook, type GameRecord } from './game-records';
import { fitRatings, publicRating } from './ratings';
import { record } from './test-records';
import { MemoryPersistence } from './test-persistence';

function seed(db: MemoryPersistence, ...games: GameRecord[]) {
  for (const g of games) {
    db.archives.set(g.replay.gameId, g.replay);
    db.links.set(g.replay.gameId, { seats: g.seats, altered: g.altered });
  }
  db.recordsVersion += 1;
}

describe('game records', () => {
  it('summarizes an account across teams, roles and recent form, rated or not', async () => {
    const db = new MemoryPersistence();
    const win = record('win'); win.replay.endedAt = 3000;
    const loss = record('loss', 'evil'); loss.replay.endedAt = 2000;
    const asEvil = record('evil'); asEvil.replay.endedAt = 1000;
    asEvil.seats = { p3: 'account0', p0: 'other' };
    const bots = record('bots'); bots.replay.endedAt = 500; bots.replay.players[4]!.isBot = true;
    seed(db, win, loss, asEvil, bots);
    const profile = historyProfile(await recordBook(db), 'account0');
    expect(profile.total).toEqual({ games: 3, wins: 1 });
    expect(profile.teams).toEqual({ good: { games: 2, wins: 1 }, evil: { games: 1, wins: 0 } });
    expect(profile.roles).toEqual([{ role: 'Merlin', games: 2, wins: 1 }, { role: 'Morgana', games: 1, wins: 0 }]);
    expect(profile.form).toEqual([true, false, false]);
    expect(profile.rating.ratedGames).toBe(2);
    expect(JSON.stringify(profile)).not.toContain('hidden');
  });

  it('pages newest first, marks unrated games and never exposes accounts', async () => {
    const db = new MemoryPersistence();
    seed(db, ...Array.from({ length: 35 }, (_, i) => {
      const g = record(`g${String(i).padStart(2, '0')}`); g.replay.endedAt = 1000 + i;
      if (i % 2) g.altered = null;
      return g;
    }));
    const book = await recordBook(db);
    const first = historyGames(book, 'account0', 0);
    expect(first.total).toBe(35);
    expect(first.next).toBe(30);
    expect(first.games[0]).toMatchObject({ gameId: 'g34', unrated: null, seat: { role: 'Merlin', won: true } });
    expect(first.games[1]).toMatchObject({ gameId: 'g33', unrated: 'legacy', seat: { delta: null } });
    expect(historyGames(book, 'account0', 30)).toMatchObject({ next: null, games: { length: 5 } });
    expect(historyGames(book, 'stranger', 0).total).toBe(0);
  });

  it('filters bots before pagination while retaining development history', async () => {
    const db = new MemoryPersistence();
    const bots = Array.from({ length: 31 }, (_, i) => {
      const game = record(`bot${i}`); game.replay.players[1]!.isBot = true;
      game.replay.endedAt = 10000 + i; return game;
    });
    seed(db, record('human'), ...bots);
    const production = historyGames(await recordBook(db), 'account0', 0);
    expect(production).toMatchObject({ total: 1, next: null, games: [{ gameId: 'human' }] });
    const development = historyGames(await recordBook(db, { includeBots: true }), 'account0', 0);
    expect(development.total).toBe(32);
    expect(development.next).toBe(30);
    expect(development.games).toHaveLength(30);
    expect(historyGames(await recordBook(db), 'account0', 0)).toEqual(production);
  });

  it('reconstructs match deltas from adjacent chronological prefixes without future leakage', async () => {
    const db = new MemoryPersistence();
    const first = record('z-first'); first.replay.endedAt = 1000;
    const others = Array.from({ length: 5 }, (_, i) => {
      const g = record(`other-${i}`, 'evil'); g.replay.endedAt = 2000 + i;
      g.seats.p0 = 'other-account'; return g;
    });
    const last = record('a-last', 'evil'); last.replay.endedAt = 3000;
    seed(db, last, ...others, first);
    const book = await recordBook(db);
    const page = historyGames(book, 'account0', 0);
    const firstScore = publicRating(fitRatings([first]).players.get('account0')).score;
    const before = publicRating(fitRatings([first, ...others]).players.get('account0')).score;
    expect(page.games.find(g => g.gameId === 'z-first')!.seat!.delta).toBe(firstScore - 1000);
    expect(page.games[0]!.seat!.delta).toBe(book.rating('account0').score - before);
    expect(historyProfile(book, 'account0').trend).toEqual([1000, firstScore, book.rating('account0').score]);
    expect(historyProfile(book, 'stranger').trend).toEqual([]);
  });

  it('refits after a correction replaces a game', async () => {
    const db = new MemoryPersistence();
    seed(db, record());
    const before = historyProfile(await recordBook(db), 'account0');
    seed(db, record('one', 'evil'));
    const after = historyProfile(await recordBook(db), 'account0');
    expect(before.total.wins).toBe(1);
    expect(after.total).toEqual({ games: 1, wins: 0 });
    expect(after.rating.score).toBeLessThan(before.rating.score);
  });

  it('recovers attendance without inventing a role, win, rating or spectator identity', async () => {
    const db = new MemoryPersistence();
    const known = record('known');
    const unknown = record('unknown'); unknown.seats = {}; unknown.altered = null;
    const bots = record('bots'); bots.seats = {}; bots.replay.players[1]!.isBot = true;
    seed(db, known, unknown, bots);
    db.participants.set('unknown', ['account0', 'account0']);
    db.participants.set('known', ['account0']);
    db.participants.set('bots', ['account0']);
    const book = await recordBook(db);
    const profile = historyProfile(book, 'account0');
    expect(profile.total).toEqual({ games: 1, wins: 1 });
    expect(profile.unresolvedGames).toBe(1);
    expect(profile.rating.ratedGames).toBe(1);
    expect(profile.form).toEqual([true]);
    const mine = historyGames(book, 'account0', 0);
    expect(mine.total).toBe(2);
    expect(mine.games.find(g => g.gameId === 'unknown')).toMatchObject({ seat: null, participationOnly: true });
    expect(historyGames(book, 'stranger', 0).total).toBe(0);
    expect(JSON.stringify(mine)).not.toContain('account0');
  });

  it('links a legacy game only through a lone human and a lone settled account', () => {
    const g = record();
    for (const player of g.replay.players.slice(1)) player.isBot = true;
    expect(legacySeatLink(g.replay, ['a', 'a'])).toEqual({ p0: 'a' });
    expect(legacySeatLink(g.replay, ['a', 'b'])).toBeNull();
    expect(legacySeatLink(record().replay, ['a'])).toBeNull();
  });
});

describe('history HTTP', () => {
  const issuer = 'https://auth.pangda.app';
  async function harness() {
    const db = new MemoryPersistence();
    const env = { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'avalon', OIDC_CLIENT_SECRET: 'test',
      OIDC_SESSION_SECRET: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', persistence: db } as unknown as Env;
    const cookie = `${SESSION_COOKIE}=${await sealSession(env, issuer, { id: 'user', username: 'User' })}`;
    const get = (path: string, signedIn = true) =>
      app.request(`https://avalon.test${path}`, { headers: signedIn ? { Cookie: cookie } : {} }, env);
    return { db, env, get };
  }

  it('requires a session and validates queries', async () => {
    const { get } = await harness();
    for (const path of ['/api/history', '/api/history/games', '/api/games/one/replay'])
      expect((await get(path, false)).status).toBe(401);
    const response = await get('/api/history?account=someone-else');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ rating: { score: 1000, ratedGames: 0 }, total: { games: 0 } });
    for (const query of ['?offset=-1', '?offset=1.5'])
      expect((await get(`/api/history/games${query}`)).status).toBe(400);
  });

  it('returns the viewer seat with a replay and counts bots only in development', async () => {
    const { db, env, get } = await harness();
    const g = record('bots');
    for (const player of g.replay.players.slice(1)) player.isBot = true;
    g.seats = { p0: accountKey(issuer, 'user') };
    seed(db, g);
    expect((await get('/api/games/bots/replay')).status).toBe(404);
    expect((await get('/api/games/missing/replay')).status).toBe(404);
    for (const environment of ['production', 'development', undefined]) {
      env.ENVIRONMENT = environment;
      const development = environment === 'development';
      expect(await (await get('/api/history/games?includeBots=true')).json()).toMatchObject({
        total: development ? 1 : 0,
        games: development ? [{ unrated: null }] : [],
      });
      expect(await (await get('/api/history')).json()).toMatchObject({
        total: { games: development ? 1 : 0 }, rating: { ratedGames: development ? 1 : 0 },
      });
      const replay = await get('/api/games/bots/replay?includeBots=true');
      expect(replay.status).toBe(development ? 200 : 404);
      expect(replay.headers.get('Cache-Control')).toBe('no-store');
      if (development) expect(await replay.json()).toMatchObject({ replay: { gameId: 'bots' }, viewerId: 'p0' });
    }
  });
});
