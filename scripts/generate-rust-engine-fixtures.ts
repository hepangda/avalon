/** Development-only differential oracle; Rust production never invokes Node. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createGame, reduce } from '../src/lib/engine/reducer';
import { createRng } from '../src/lib/engine/rng';
import { roleVariants } from '../src/lib/engine/roleVariants';
import { projectStateForViewer } from '../src/lib/engine/projection';
import { weightedRoleAssignment } from '../src/lib/engine/roleWeights';
import { decideBot } from '../server/bots';
import type { GameEvent, GameOptions } from '../src/lib/engine/types';
const canonical=(x:any):string=>Array.isArray(x)?`[${x.map(canonical).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).filter(k=>x[k]!==undefined).sort().map(k=>`${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`:JSON.stringify(x);
const hash=(x:any)=>createHash('sha256').update(canonical(x)).digest('hex');
const resolvedState=(state:any)=>({...state,randomnessVersion:'resolved-v1',roleVariants:state.phase==='Lobby'?{}:roleVariants(state)});
const resolvedEvent=(event:GameEvent,state:any)=>{
 const output:any={...event};
 if(['START_GAME','REROLL_ROLES','USE_REROLL_CARD'].includes(event.type)){output.assignedRoles=state.players.map((p:any)=>p.role);output.roleVariants=roleVariants(state);}
 if(['START_GAME','REROLL_LEADER'].includes(event.type))output.leaderIndex=state.leaderIndex;
 if(event.type==='START_GAME')output.seatOrder=[...state.players].sort((a:any,b:any)=>a.seat-b.seat).map((p:any)=>p.id);
 return output;
};
const traces:any[]=[]; const botCases:any[]=[]; const weightCases:any[]=[];
for(let version=1;version<=5;version++)for(let n=5;n<=10;n++)for(let mode=0;mode<3;mode++){
 const seed=`兼容🧙:${version}:${n}:${mode}`;
 const options:GameOptions={percival: true,morgana:mode!==2,mordred:n>=7&&mode!==1,oberon:n>=7&&mode===1,ladyOfTheLake:true,speechSeconds:73,maxRejections:mode===2?3:5};
 const input={hostId:'p0',players:Array.from({length:n},(_,i)=>({id:`p${i}`,name:`玩家${i}`})),options,seed};
 const created=createGame(input);if(!created.ok)throw created.error;
 let state=created.state;const trace:any={name:seed,input,initial:hash(state),resolvedInitial:hash(resolvedState(state)),steps:[]};let clock=1_700_000_000_000;let serial=0;
 const apply=(event:GameEvent)=>{const now=clock+=137;const rngSeed=`${seed}:event:${serial++}`;const before=state;const result=reduce(state,event,{now,rng:createRng(rngSeed)});const step:any={event,now,seed:rngSeed};if(result.ok){state=result.state;step.state=hash(state);step.resolvedState=hash(resolvedState(state));step.resolvedEvent=resolvedEvent(event,state);step.effects=result.effects;step.views=hash([...input.players.map(p=>projectStateForViewer(state,p.id)),projectStateForViewer(state,'observer')]);}else{step.error=result.error;if(hash(before)!==hash(state))throw new Error('mutated');}trace.steps.push(step);if(process.env.DUMP_TRACE===seed&&Number(process.env.DUMP_STEP)===trace.steps.length-1)writeFileSync('/tmp/expected-engine-state.json',JSON.stringify(result,null,2));return result.ok;};
 apply({type:'START_GAME',by:'invalid'});apply({type:'ACK_ROLE',by:'p0'});
 apply({type:'START_GAME',by:'p0',flowVersion:version as any,awaitRoleAcks:true});
 apply({type:'PROPOSE_TEAM',by:state.players[state.leaderIndex]!.id,team:['p0','p1']});
 if(mode===0){apply({type:'REROLL_LEADER',actor:'裁判'});apply({type:'REROLL_ROLES',actor:'裁判'});const p=state.players[2]!;apply({type:'USE_REROLL_CARD',by:p.id,roleRevision:state.roleRevision??0});}
 if(mode===1){const roles=[...state.config.roles].reverse();apply({type:'REROLL_ROLES',actor:'裁判',assignedRoles:roles});}
 apply({type:'ACK_ROLE',by:'invalid'});apply({type:'ACK_ROLE',by:'p0',roleRevision:999});
 for(const p of state.players)apply({type:'ACK_ROLE',by:p.id,roleRevision:state.roleRevision??0});apply({type:'ACK_ROLE',by:'p0',roleRevision:state.roleRevision??0});
 apply({type:'SET_TIMERS_PAUSED',paused:true,actor:'裁判'});apply({type:'SET_TIMERS_PAUSED',paused:true,actor:'裁判'});apply({type:'SET_TIMERS_PAUSED',paused:false,actor:'裁判'});
 apply({type:'SET_CONNECTED',by:'p1',connected:false});apply({type:'SET_CONNECTED',by:'p1',connected:true});
 const reds=state.players.filter(p=>['Assassin','Morgana','Minion','Mordred'].includes(p.role));
 if(mode===0){apply({type:'REQUEST_ASSASSINATION',by:reds[0]!.id});apply({type:'VOTE_ASSASSINATION',by:reds[1]!.id,proposalId:state.earlyAssassination!.id,value:'reject'});}
 let rewind=false,retract=false,revote=false;
 for(let turn=0;turn<260&&state.phase!=='GameOver';turn++){
  const view=projectStateForViewer(state,state.players[state.leaderIndex]!.id);const leader=state.players.find(p=>p.seat===state.leaderIndex)!.id;
  if(mode===1&&state.roundIndex===1&&state.phase==='TeamBuilding'){
   apply({type:'REQUEST_ASSASSINATION',by:reds[0]!.id});for(const id of state.earlyAssassination?.voterIds??[])if(!state.earlyAssassination?.votes[id])apply({type:'VOTE_ASSASSINATION',by:id,proposalId:state.earlyAssassination!.id,value:'approve'});continue;
  }
  if(!rewind&&state.phase==='MissionVote'){rewind=true;apply({type:'PREVIOUS_PHASE',actor:'裁判'});continue;}
  switch(state.phase){
   case 'TeamBuilding':{
    const size=view.config.missionSizes[state.roundIndex]!;
    const evil=state.players.filter(p=>['Assassin','Morgana','Mordred','Minion','Oberon'].includes(p.role));const good=state.players.filter(p=>!evil.includes(p));
    const preferred=mode===0&&state.roundIndex%2===1?[...evil,...good]:[...good,...evil];
    apply({type:'PROPOSE_TEAM',by:'invalid',team:preferred.slice(0,size).map(p=>p.id)});apply({type:'PROPOSE_TEAM',by:leader,team:preferred.slice(0,size).map(p=>p.id)});break;
   }
   case 'TeamAnnouncement':apply({type:'START_DISCUSSION',by:leader,direction:mode===0?'counterclockwise':'clockwise'});break;
   case 'Discussion':apply(turn%3===0?{type:'SKIP_SPEECH',target:state.discussion!.order[state.discussion!.speakerIndex]!,actor:'裁判'}:{type:'END_SPEECH',by:state.discussion!.order[state.discussion!.speakerIndex]!});break;
   case 'TeamFinalizing':apply({type:'FINALIZE_TEAM',by:leader,team:[...state.proposedTeam!].reverse()});break;
   case 'Voting':{
    if(!retract){retract=true;apply({type:'RETRACT_PROPOSAL'});break;}
    if(!revote){revote=true;apply({type:'CAST_VOTE',by:'p0',value:'approve'});apply({type:'RETRACT_VOTES'});}
    // Reverse vote insertion order proves JSON objects do not sort vote-history arrays.
    for(const p of [...state.players].reverse()){if(state.phase!=='Voting')break;apply({type:'CAST_VOTE',by:p.id,value:mode===2?'reject':state.roundIndex===0&&state.rejectionCount===0?'reject':'approve'});}break;
   }
   case 'MissionVote':for(const id of [...state.proposedTeam!]){if(state.phase!=='MissionVote')break;const role=state.players.find(p=>p.id===id)!.role;const evil=['Assassin','Morgana','Mordred','Minion','Oberon'].includes(role);apply({type:'CAST_MISSION_CARD',by:id,card:evil?'fail':'success'});}break;
   case 'LadyOfLake':apply({type:'USE_LADY',by:state.ladyHolderId!,target:state.players.find(p=>p.id!==state.ladyHolderId&&!state.ladyInspectedIds.includes(p.id))!.id});break;
   case 'Assassination':apply({type:'ASSASSINATE',by:state.assassinId!,target:state.players.find(p=>p.role===(mode===1?'Merlin':'LoyalServant'))!.id});break;
   default:throw new Error(`stuck ${state.phase}`);
  }
  if(mode===0&&n>=7&&trace.steps.length%7===0){for(const timer of state.actionTimers??[]){const projection=projectStateForViewer(state,timer.playerId);const seed=`decision:${trace.steps.length}:${timer.playerId}`;botCases.push({view:projection,by:timer.playerId,action:timer.action,seed,result:decideBot(projection,timer.playerId,timer.action,seed)});}}
 }
 if(state.phase!=='GameOver')throw new Error(`unfinished ${seed}`);
 apply({type:'PREVIOUS_PHASE',actor:'裁判'});apply({type:'START_ASSASSINATION',by:state.assassinId!,admin:true,actor:'裁判'});
 if(mode===0){while(state.phaseHistory?.length)apply({type:'PREVIOUS_PHASE',actor:'裁判'});apply({type:'PREVIOUS_PHASE',actor:'裁判'});}
 traces.push(trace);
 const weights=Object.fromEntries(input.players.map((p,i)=>[p.id,{Merlin:50+i*75,Assassin:1000-i*10,LoyalServant:500+i*25}]));
 for(const excluded of [undefined,{playerId:'p2',role:'Merlin' as const}])weightCases.push({players:input.players,deck:state.config.roles,weights,seed,excluded,result:weightedRoleAssignment(input.players,state.config.roles,weights,createRng(seed),excluded)});
}
// Full autonomous tables exercise behavioral evidence, hiding, Lady and assassination.
for(const n of [5,7,10])for(let sample=0;sample<4;sample++){
 const seed=`bots-cross-language:${n}:${sample}`;
 const input={hostId:'p0',players:Array.from({length:n},(_,i)=>({id:`p${i}`,name:`P${i}`})),options:{morgana:true,percival:true,mordred:n>=7&&sample%2===0,oberon:n>=7&&sample%2===1,ladyOfTheLake:true},seed};
 const created=createGame(input);if(!created.ok)throw created.error;let state=created.state;let clock=1800000000000;const trace:any={name:seed,input,initial:hash(state),resolvedInitial:hash(resolvedState(state)),steps:[]};
 for(let turn=0;turn<800&&state.phase!=='GameOver';turn++){
  const timer=state.actionTimers?.[0];const botSeed=`${seed}:bot:${turn}`;
  const decision=turn===0?null:decideBot(projectStateForViewer(state,timer!.playerId),timer!.playerId,timer!.action,botSeed);
  const event:GameEvent=decision?.event??{type:'START_GAME',by:'p0',flowVersion:5};const now=clock+=137;const rngSeed=`${seed}:engine:${turn}`;const result=reduce(state,event,{now,rng:createRng(rngSeed)});if(!result.ok)throw result.error;state=result.state;
  trace.steps.push({event,now,seed:rngSeed,state:hash(state),resolvedState:hash(resolvedState(state)),resolvedEvent:resolvedEvent(event,state),effects:result.effects,views:hash([...input.players.map(p=>projectStateForViewer(state,p.id)),projectStateForViewer(state,'observer')]),...(timer?{bot:{by:timer.playerId,action:timer.action,seed:botSeed,reason:decision!.reason,hypotheses:decision!.hypotheses,consistent:decision!.consistent}}:{})});
 }
 if(state.phase!=='GameOver')throw new Error(`unfinished ${seed}`);traces.push(trace);
}
const resolved=traces.map(t=>({name:t.name,input:t.input,initial:t.resolvedInitial,steps:t.steps.filter((s:any)=>!s.error).map((s:any)=>({event:s.resolvedEvent,now:s.now,state:s.resolvedState,effects:s.effects,views:s.views}))}));
writeFileSync('backend/tests/fixtures/resolved-engine-traces.json',JSON.stringify(resolved));
const legacy=traces.map(({resolvedInitial:_initial,...t})=>({...t,steps:t.steps.map(({resolvedEvent:_event,resolvedState:_state,...s}:any)=>s)}));
writeFileSync('backend/tests/fixtures/engine-traces.json',JSON.stringify(legacy));
writeFileSync('backend/tests/fixtures/bot-decisions.json',JSON.stringify(botCases));
writeFileSync('backend/tests/fixtures/weighted-roles.json',JSON.stringify(weightCases));
console.log(`${traces.length} game traces, ${traces.reduce((n,t)=>n+t.steps.length,0)} transitions, ${botCases.length} bot decisions, ${weightCases.length} weighted deals`);
