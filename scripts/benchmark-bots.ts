import { simulateBotGame, type BotMatchup } from '../server/test-bot-simulation';

const games = Number(process.argv[2] ?? 50);
if (!Number.isInteger(games) || games < 1 || games > 1000) throw new Error('Usage: npm run benchmark:bots -- [games per size, 1–1000]');
const rows = [];
for (const matchup of ['baseline', 'new', 'new-good', 'new-evil'] satisfies BotMatchup[]) {
  for (let count = 5; count <= 10; count++) {
    const totals = { proposals: 0, missions: 0, forced: 0, straightFails: 0, goodMissions: 0, goodWins: 0, assassinationHits: 0, rejectionLoss: 0, hiddenPasses: 0 };
    const timings: number[] = [];
    for (let i = 0; i < games; i++) {
      // Same deals and engine seeds in each matchup. Alternate Mordred/Oberon
      // on larger tables instead of fitting only the easy no-Mordred lineup.
      const options = count >= 7 ? { mordred: i % 3 === 1, oberon: i % 3 === 2, ladyOfTheLake: true } : {};
      const result = simulateBotGame(count, `crossplay:${count}:${i}`, options, matchup);
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += result.metrics[key];
      timings.push(...result.decisionMs);
    }
    timings.sort((a, b) => a - b);
    const row = { matchup, count, games, goodWinPercent: Math.round(totals.goodWins / games * 100),
      assassinationHitPercent: totals.goodMissions ? Math.round(totals.assassinationHits / totals.goodMissions * 100) : null,
      proposalsPerMission: +(totals.proposals / totals.missions).toFixed(2),
      rejectionLosses: totals.rejectionLoss, decisionP95Ms: +(timings[Math.floor(timings.length * 0.95)] ?? 0).toFixed(2) };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
console.table(rows);
