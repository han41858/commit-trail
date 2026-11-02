import {useRef} from 'react';
import {debug,noChanges,type DebugCycle,type RefreshKind} from './debug';
import {captureChanges,changeCounts} from './debugChanges';
import type {History} from './history';
import type {CommitInfoStore} from './CommitInfoStore';
import type {RefreshResult} from './RefreshLoop';

// Debug-only bookkeeping for refresh and repository-open cycles, kept out of the app root.
// Every function falls through to the plain operation while debug mode is off.

export async function measureRefresh(kind:RefreshKind,history:History,info:CommitInfoStore,run:(cycle:DebugCycle|undefined)=>Promise<RefreshResult>):Promise<RefreshResult>{
 const before=debug.enabled()?captureChanges(history.getSnapshot(),info.getSnapshot()):undefined;
 const cycle:DebugCycle|undefined=before
  ?debug.beginCycle(kind,()=>cycle?.cancelled?noChanges():changeCounts(before,captureChanges(history.getSnapshot(),info.getSnapshot())))
  :undefined;
 debug.bindGraph(history.getSnapshot().commits,cycle);
 try{
  const result=await run(cycle);
  debug.finish(cycle,'work',result.error?'failed':'completed');
  return result;
 }catch(error){debug.finish(cycle,'work','failed');throw error;}
}

type InitialCycle={cycle:DebugCycle;metadataStarted:boolean};

// One "initial" cycle spans the history open and the metadata open that follows it.
export function useMeasuredOpen(history:History,info:CommitInfoStore){
 const initial=useRef<InitialCycle|null>(null);
 function cancel(){
  const current=initial.current;if(!current)return;
  current.cycle.cancelled=true;
  if(!current.metadataStarted)debug.finish(current.cycle,'metadata','cancelled');
 }
 function open(value:string,token:string,branch?:string){
  cancel();
  if(!debug.enabled()){initial.current=null;return history.open(value,token,undefined,branch);}
  const baseline={commits:new Map(),branches:new Map(),tags:new Map(),releases:new Map(),actions:new Map()};
  const cycle:DebugCycle=debug.beginCycle('initial',
   ()=>cycle.cancelled||!cycle.sample.requests?noChanges():changeCounts(baseline,captureChanges(history.getSnapshot(),info.getSnapshot())),
   ['history','metadata'])!;
  const current={cycle,metadataStarted:false};initial.current=current;
  return history.open(value,token,cycle,branch).finally(()=>{
   const snapshot=history.getSnapshot(),extras=info.getSnapshot();
   debug.finish(cycle,'history',snapshot.error?'failed':'completed');
   const metadataSkipped=!!snapshot.error||!snapshot.meta||cycle.cancelled||extras.repo===snapshot.repo&&!extras.busy;
   if(!current.metadataStarted&&metadataSkipped)debug.finish(cycle,'metadata');
  });
 }
 // repo is '' until repository metadata has loaded.
 function openInfo(repo:string,token:string){
  const current=repo?initial.current:null;
  if(current&&!current.cycle.cancelled)current.metadataStarted=true;
  const task=info.open(repo,token,current?.cycle);
  if(current)void task.finally(()=>debug.finish(current.cycle,'metadata',Object.keys(info.getSnapshot().errors).length?'failed':'completed'));
  return task;
 }
 return {open,cancel,openInfo};
}
