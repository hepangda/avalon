/** Regenerate cross-language fixtures from the retained TypeScript oracle. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { record } from '../server/test-records';
import { exclusion, fitRatings, publicRating } from '../server/ratings';
import { historyProfile, historyGames, recordBook, seatRecord } from '../server/game-records';
import type { Persistence } from '../server/persistence';
import { createGame, createRng, reduce, leaderId, currentMissionSize, type GameEvent, type GameState } from '../src/lib/engine';
import { roleVariants } from '../src/lib/engine/roleVariants';
import { DEFAULT_OPTIONS } from '../src/lib/engine/testkit';
import { buildReplayFromEvents } from '../server/replay-builder';

mkdirSync('backend/tests/fixtures', { recursive: true });
function resolvedEvent(event: GameEvent, state: GameState) {
  const resolved: Record<string, unknown> = { ...event };
  if (['START_GAME', 'REROLL_ROLES', 'USE_REROLL_CARD'].includes(event.type)) {
    resolved.assignedRoles = state.players.map(player => player.role);
    resolved.roleVariants = roleVariants(state);
  }
  if (['START_GAME', 'REROLL_LEADER'].includes(event.type)) resolved.leaderIndex = state.leaderIndex;
  if (event.type === 'START_GAME') resolved.seatOrder = [...state.players].sort((a,b)=>a.seat-b.seat).map(player=>player.id);
  return resolved;
}

const records = Array.from({ length: 35 }, (_, i) => {
  const g = record(`game-${String(i).padStart(3, '0')}`, i % 2 === 0 ? 'evil' : 'good');
  g.replay.endedAt = 1000 + i;
  if (i % 3 === 0) [g.seats.p0, g.seats.p4] = [g.seats.p4!, g.seats.p0!];
  if (i > 25) g.altered = null;
  if (i === 8) { g.altered = null; delete g.replay.options; }
  if (i === 12) { g.replay.players[0]!.isBot = true; delete g.seats.p0; }
  if (i === 15) { g.altered = null; delete g.replay.options; g.ratingImport = 'name-recovery-v1'; }
  if (i === 20) { g.seats = {}; g.participants = ['account0', 'account1']; }
  if (i === 22) g.replay.roleAssignments.pop();
  g.replay.rounds = [{ roundIndex: 0, leaderPlayerId: 'p0', teamSize: 2, finalTeam: ['p0', 'p1'], approved: true, missionSuccess: i % 2 === 0, failCount: i % 2, votes: [], proposals: [], missionCards: [] }];
  return g;
});
const policies = [];
for (const includeBots of [false, true]) {
  const policy = { includeBots };
  const book = await recordBook({ gameRecordsVersion: async () => 'fixture', listGameRecords: async () => records } as unknown as Persistence, policy);
  const fit = fitRatings(records, policy);
  policies.push({ includeBots, exclusions: records.map(g => exclusion(g, policy)), fit: { players: Object.fromEntries(fit.players), parameters: fit.parameters, covariance: fit.covariance, accounts: fit.accounts, configs: fit.configs }, public: Object.fromEntries([...fit.players].map(([a,p]) => [a,publicRating(p,100000)])), profiles: ['account0','account3','missing'].map(account => ({account, profile:historyProfile(book,account), games:historyGames(book,account,0), next:historyGames(book,account,30), visible:seatRecord(book,account), hidden:seatRecord(book,account,true)})) });
}
writeFileSync('backend/tests/fixtures/history.json', JSON.stringify({records,policies},null,2)+'\n');
const seed='full';const players=Array.from({length:5},(_,i)=>({id:`p${i}`,name:`P${i}`,...(i===1?{avatarUrl:'https://example.com/a.png',isBot:true}:{})}));
const created=createGame({hostId:'p0',players,options:DEFAULT_OPTIONS,seed});if(!created.ok)throw new Error('create');let state=created.state;const events:Array<{seq:number,event:GameEvent,createdAt:number}>=[];const resolvedEvents:unknown[]=[];
function apply(event:GameEvent){const seq=events.length+1;const result=reduce(state,event,{now:1000*seq,rng:createRng(`${seed}:${seq}`)});if(!result.ok)throw new Error(result.error.message);events.push({seq,event,createdAt:1000*seq});state=result.state;resolvedEvents.push({seq,event:resolvedEvent(event,state),createdAt:1000*seq});}
apply({type:'START_GAME',by:'p0',flowVersion:1});for(let i=0;i<5;i++){apply({type:'PROPOSE_TEAM',by:leaderId(state),team:['p0','p1']});for(const p of players)apply({type:'CAST_VOTE',by:p.id,value:'reject'});}
writeFileSync('backend/tests/fixtures/replay.json',JSON.stringify({gameId:'full',seed,players,options:DEFAULT_OPTIONS,events,resolvedEvents,finalState:state,expected:buildReplayFromEvents('full',seed,DEFAULT_OPTIONS,players,events)},null,2)+'\n');

// Referee rewind must discard abandoned proposals, mission cards and Lady checks.
{
  const seed='replay-referee';const options={...DEFAULT_OPTIONS,ladyOfTheLake:true};
  const players=Array.from({length:5},(_,i)=>({id:`p${i}`,name:`Player ${i}`}));
  const created=createGame({hostId:'p0',players,options,seed});if(!created.ok)throw new Error('create');
  let state=created.state;const events:Array<{seq:number,event:GameEvent,createdAt:number}>=[];const resolvedEvents:unknown[]=[];
  const apply=(event:GameEvent)=>{const seq=events.length+1;const result=reduce(state,event,{now:seq,rng:createRng(`${seed}:${seq}`)});if(!result.ok)throw new Error(result.error.message);events.push({seq,event,createdAt:seq});state=result.state;resolvedEvents.push({seq,event:resolvedEvent(event,state),createdAt:seq});};
  const propose=(team:string[])=>{const by=leaderId(state);apply({type:'PROPOSE_TEAM',by,team});for(const by of state.discussion!.order)apply({type:'END_SPEECH',by});apply({type:'FINALIZE_TEAM',by,team});};
  const vote=(value:'approve'|'reject')=>{for(const p of players)apply({type:'CAST_VOTE',by:p.id,value});};
  const back:GameEvent={type:'PREVIOUS_PHASE',actor:'Referee'};
  apply({type:'START_GAME',by:'p0',flowVersion:4});propose(['p0','p1']);vote('reject');apply(back);vote('approve');
  for(const by of ['p0','p1'])apply({type:'CAST_MISSION_CARD',by,card:'success'});
  const team=players.slice(0,currentMissionSize(state)).map(p=>p.id);propose(team);vote('approve');for(const by of team)apply({type:'CAST_MISSION_CARD',by,card:'success'});
  const holder=state.ladyHolderId!;apply({type:'USE_LADY',by:holder,target:players.find(p=>p.id!==holder)!.id});apply(back);apply(back);
  const assassin=state.assassinId!;apply({type:'START_ASSASSINATION',by:assassin,admin:true,actor:'Referee'});apply({type:'ASSASSINATE',by:assassin,target:state.players.find(p=>p.role==='Merlin')!.id});
  writeFileSync('backend/tests/fixtures/replay-rewind.json',JSON.stringify({gameId:'rewind',seed,players,options,events,resolvedEvents,finalState:state,expected:buildReplayFromEvents('rewind',seed,options,players,events)},null,2)+'\n');
}
