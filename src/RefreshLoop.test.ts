import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RefreshLoop,type RefreshClock,type RefreshResult} from './RefreshLoop';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function timer(){let now=1000,id=0;const tasks=new Map<number,{at:number;fn:()=>void}>();const clock:RefreshClock={now:()=>now,set:(fn,ms)=>{tasks.set(++id,{at:now+ms,fn});return id;},clear:key=>{tasks.delete(key as number);}};return {clock,tasks,advance:async(ms:number)=>{const until=now+ms;while(true){const task=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!task||task[1].at>until)break;now=task[1].at;tasks.delete(task[0]);task[1].fn();await flush();}now=until;}};}
test('one refresh loop reschedules after manual refresh and supports OFF',async()=>{
 const time=timer();let calls=0;const loop=new RefreshLoop(async()=>{calls++;return {};},()=>true,time.clock);loop.configure('repo',true,60000);loop.loaded();
 await time.advance(30000);await loop.refresh();assert.equal(calls,1);await time.advance(59000);assert.equal(calls,1);await time.advance(1000);assert.equal(calls,2);
 loop.configure('repo',false,60000);await time.advance(120000);assert.equal(calls,2);await loop.refresh();assert.equal(calls,3);assert.equal(time.tasks.size,0);
});
test('hidden and offline periods pause polling, overdue return refreshes once',async()=>{
 const time=timer();let active=true,calls=0;const loop=new RefreshLoop(async()=>{calls++;return {};},()=>active,time.clock);loop.configure('repo',true,60000);
 active=false;loop.visibilityChanged();await time.advance(180000);assert.equal(calls,0);
 active=true;loop.visibilityChanged();await time.advance(0);assert.equal(calls,1);
});
test('a slow refresh cannot overlap automatic or manual work',async()=>{
 const time=timer();let done!:(value:{})=>void,calls=0;const loop=new RefreshLoop(()=>{calls++;return new Promise(resolve=>{done=resolve;});},()=>true,time.clock);loop.configure('repo',true,30000);
 const first=loop.refresh();assert.equal(loop.refresh(),first);await flush();await time.advance(90000);assert.equal(calls,1);done({});await first;assert.equal(time.tasks.size,1);
});
test('rate limit records completion and pauses until the server deadline',async()=>{
 const time=timer();let limited=false,calls=0;const loop=new RefreshLoop(async()=>{calls++;return limited?{error:'Rate limit',retryAt:201000}:{};},()=>true,time.clock);loop.configure('repo',true,60000);await loop.refresh();assert.equal(loop.getSnapshot().lastCompletedAt,1000);
 limited=true;await time.advance(60000);assert.equal(loop.getSnapshot().lastCompletedAt,61000);await loop.refresh();assert.equal(calls,2);await time.advance(139999);assert.equal(calls,2);limited=false;await time.advance(1);assert.equal(calls,3);assert.equal(loop.getSnapshot().error,'');
});
test('repository changes invalidate an old refresh completion',async()=>{
 const time=timer();let done!:(value:{error:string})=>void;const loop=new RefreshLoop(()=>new Promise(resolve=>{done=resolve;}),()=>true,time.clock);loop.configure('old',true,60000);const old=loop.refresh();await flush();loop.configure('new',false,60000);done({error:'Old error'});await old;assert.equal(loop.getSnapshot().error,'');assert.equal(loop.getSnapshot().lastCompletedAt,null);assert.equal(loop.getSnapshot().running,false);
});
test('the production clock initializes without a custom test clock',()=>{const loop=new RefreshLoop(async()=>({}));loop.configure('repo',false,60000);assert.equal(loop.getSnapshot().running,false);loop.stop();});

test('manual and scheduled automatic refreshes provide distinct measurement origins',async()=>{
 const time=timer(),origins:string[]=[];const loop=new RefreshLoop(async kind=>{origins.push(kind);return {};},()=>true,time.clock);
 loop.configure('repo',true,60000);loop.loaded();await loop.refresh();await time.advance(60000);assert.deepEqual(origins,['manual','auto']);loop.stop();
});
for(const outcome of ['success','failure','rejection'] as const)test(`a single ${outcome} records the attempt end, never its start`,async()=>{
 const time=timer();let finish!:(result:RefreshResult)=>void,fail!:(error:Error)=>void;
 const loop=new RefreshLoop(()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;}),()=>true,time.clock);
 loop.configure('repo',false,60000);loop.loaded();await time.advance(500);
 const task=loop.refresh();await flush();await time.advance(2000);loop.loaded();
 assert.equal(loop.getSnapshot().lastCompletedAt,1000);assert.equal(loop.getSnapshot().running,true);
 if(outcome==='rejection')fail(new Error('Network failed'));else finish(outcome==='failure'?{error:'API failed'}:{});
 await task;assert.equal(loop.getSnapshot().lastCompletedAt,3500);assert.equal(loop.getSnapshot().nextAt,63500);
 assert.equal(loop.getSnapshot().error,outcome==='success'?'':outcome==='failure'?'API failed':'Network failed');
});
test('dispatch completion keeps its deadline while deferred work controls only the completion timestamp',async()=>{
 const time=timer();let finish!:(completed:boolean)=>void;
 const completion=new Promise<boolean>(resolve=>{finish=resolve;});
 const loop=new RefreshLoop(async()=>({completion}),()=>true,time.clock);loop.configure('monitor',true,60000);
 await loop.refresh();assert.equal(loop.getSnapshot().lastCompletedAt,null);assert.equal(loop.getSnapshot().running,false);
 assert.equal(loop.getSnapshot().nextAt,61000);assert.equal(time.tasks.size,1);
 await time.advance(5000);loop.loaded();assert.equal(loop.getSnapshot().lastCompletedAt,null);
 finish(true);await flush();assert.equal(loop.getSnapshot().lastCompletedAt,6000);assert.equal(loop.getSnapshot().nextAt,61000);loop.stop();
});
test('an empty or cancelled dispatch never records a completion',async()=>{
 const time=timer();let result:RefreshResult={completion:null};
 const loop=new RefreshLoop(async()=>result,()=>true,time.clock);loop.configure('monitor',false,60000);loop.loaded();
 await time.advance(2000);await loop.refresh();assert.equal(loop.getSnapshot().lastCompletedAt,1000);
 result={completion:Promise.resolve(false)};await loop.refresh();await flush();assert.equal(loop.getSnapshot().lastCompletedAt,1000);
});
test('scope changes and stop discard late deferred completions as well as direct refreshes',async()=>{
 for(const deferred of [false,true])for(const stop of [false,true]){
  const time=timer();let finish!:()=>void;
  const waiting=new Promise<void>(resolve=>{finish=resolve;});
  const loop=new RefreshLoop(async()=>{if(deferred)return {completion:waiting.then(()=>true)};await waiting;return {error:'Old failure'};},()=>true,time.clock);
  loop.configure('old',false,60000);const task=loop.refresh();await flush();
  if(stop)loop.stop();else loop.configure('new',false,60000);
  await time.advance(3000);finish();await task;await flush();
  assert.equal(loop.getSnapshot().lastCompletedAt,null);assert.equal(loop.getSnapshot().error,'');assert.equal(loop.getSnapshot().running,false);
 }
});
test('Split view waits for its initial load before scheduling a full first interval',async()=>{
 const time=timer();let calls=0;
 const loop=new RefreshLoop(async()=>{calls++;return {};},()=>true,time.clock);
 loop.configure('monitor:a|b',true,60000,true);
 assert.equal(loop.getSnapshot().waitingForInitialLoad,true);assert.equal(loop.getSnapshot().nextAt,0);assert.equal(time.tasks.size,0);
 await time.advance(180000);await loop.refresh('auto');assert.equal(calls,0);
 loop.visibilityChanged();assert.equal(time.tasks.size,0);
 loop.loaded();assert.equal(loop.getSnapshot().waitingForInitialLoad,false);assert.equal(loop.getSnapshot().nextAt,241000);
 await time.advance(59999);assert.equal(calls,0);await time.advance(1);assert.equal(calls,1);loop.stop();
});
test('changing interval or toggling automatic refresh during initial load does not start a timer',async()=>{
 const time=timer(),loop=new RefreshLoop(async()=>({}),()=>true,time.clock);
 loop.configure('monitor',true,60000,true);await time.advance(20000);loop.configure('monitor',false,300000,true);loop.configure('monitor',true,30000,true);
 assert.equal(time.tasks.size,0);assert.equal(loop.getSnapshot().nextAt,0);
 loop.loaded();assert.equal(loop.getSnapshot().nextAt,51000);assert.equal(time.tasks.size,1);loop.stop();
});
test('manual work during initial load cannot arm automatic polling before initial settlement',async()=>{
 const time=timer();let finish!:(value:boolean)=>void;
 const completion=new Promise<boolean>(resolve=>{finish=resolve;});
 const loop=new RefreshLoop(async()=>({completion}),()=>true,time.clock);loop.configure('monitor',true,60000,true);
 await loop.refresh();loop.loaded();assert.equal(loop.getSnapshot().waitingForInitialLoad,true);assert.equal(loop.getSnapshot().nextAt,0);
 await time.advance(5000);finish(true);await flush();assert.equal(time.tasks.size,0);
 loop.loaded();const next=loop.getSnapshot().nextAt;assert.equal(next,66000);await time.advance(5000);loop.loaded();assert.equal(loop.getSnapshot().nextAt,next);loop.stop();
});
test('a stale automatic callback rechecks the updated deadline and enabled state',async()=>{
 const time=timer();let calls=0;const loop=new RefreshLoop(async()=>{calls++;return {};},()=>true,time.clock);
 loop.configure('monitor',true,60000);loop.loaded();const stale=[...time.tasks.values()][0].fn;
 await time.advance(10000);loop.configure('monitor',true,300000);stale();await flush();assert.equal(calls,0);assert.equal(time.tasks.size,1);
 loop.configure('monitor',false,300000);stale();await flush();assert.equal(calls,0);assert.equal(time.tasks.size,0);loop.stop();
});
test('a new monitor scope waits again and initial errors do not shorten its next interval',async()=>{
 const time=timer(),loop=new RefreshLoop(async()=>({error:'API failed'}),()=>true,time.clock);
 loop.configure('first',true,60000,true);loop.loaded();await loop.refresh();loop.configure('second',true,60000,true);
 assert.equal(loop.getSnapshot().waitingForInitialLoad,true);assert.equal(time.tasks.size,0);
 await time.advance(4000);loop.loaded();assert.equal(loop.getSnapshot().nextAt,65000);loop.stop();
});
