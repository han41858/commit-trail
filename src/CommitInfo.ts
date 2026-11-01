export type TagInfo={name:string;sha:string;url:string};
export type ReleaseInfo={id:number;tag_name:string;name:string|null;draft:boolean;prerelease:boolean;published_at:string|null;created_at:string;html_url:string};
export type ActionRun={id:number;workflow_id:number;head_sha:string;name:string|null;status:string|null;conclusion:string|null;run_attempt?:number;updated_at:string;run_started_at?:string|null;html_url:string};
export type ActionJob={id:number;run_id:number;run_attempt?:number;status:string;conclusion:string|null};
export type JobInfo={attempt:number;jobs:ActionJob[];total:number;complete:boolean;next:number};
export type ActionState='queued'|'running'|'success'|'failure'|'cancelled'|'skipped';
export type ActionSummary={state:ActionState;done:number|null;total:number|null;ratio:number|null};
export type CommitInfo={tags:TagInfo[];releases:ReleaseInfo[];runs:ActionRun[];actions:ActionSummary|null};
export const attempt=(run:ActionRun)=>run.run_attempt||1;
export const activeRun=(run:ActionRun)=>['queued','pending','waiting','requested','in_progress'].includes(run.status||'');
export function newerRun(old:ActionRun|undefined,next:ActionRun){return !old||attempt(next)>attempt(old)||attempt(next)===attempt(old)&&Date.parse(next.updated_at)>=Date.parse(old.updated_at);}
const runJobs=(run:ActionRun,info:JobInfo)=>[...new Map(info.jobs.filter(job=>job.run_id===run.id&&(job.run_attempt===undefined||job.run_attempt===info.attempt)).map(job=>[job.id,job])).values()];
export function actionSummary(input:readonly ActionRun[],details:ReadonlyMap<number,JobInfo>):ActionSummary|null{
 const byId=new Map<number,ActionRun>();for(const run of input)if(newerRun(byId.get(run.id),run))byId.set(run.id,run);
 const runs=[...byId.values()];if(!runs.length)return null;
 const failed=runs.some(run=>run.status==='completed'&&['failure','timed_out','startup_failure'].includes(run.conclusion||''));
 const state:ActionState=runs.some(activeRun)?runs.some(run=>run.status==='in_progress')?'running':'queued':failed?'failure':runs.every(run=>run.status==='completed'&&run.conclusion==='success')?'success':runs.every(run=>run.status==='completed'&&run.conclusion==='cancelled')?'cancelled':'skipped';
 let done=0,total=0;
 for(const run of runs){
  const info=details.get(run.id);
  if(!info||!info.complete||info.attempt!==attempt(run)||info.total<0)return {state,done:null,total:null,ratio:null};
  const jobs=runJobs(run,info);
  if(jobs.length!==info.total||jobs.some(job=>!['completed','queued','waiting','pending','requested','in_progress'].includes(job.status)))return {state,done:null,total:null,ratio:null};
  total+=jobs.length;done+=jobs.filter(job=>job.status==='completed').length;
 }
 return {state,done,total,ratio:total?done/total:null};
}
export function completedJobCount(run:ActionRun,details:ReadonlyMap<number,JobInfo>):{completed:number;total:number}|null{
 const summary=actionSummary([run],details);
 if(summary?.done===null||summary?.done===undefined||summary.total===null)return null;
 return {completed:summary.done,total:summary.total};
}
export const actionText=(state:ActionState)=>({queued:'Queued / waiting',running:'In progress',success:'Success',failure:'Failure / timed out / startup failure',cancelled:'Cancelled',skipped:'Skipped / not run'}[state]);
export type RunStatus={icon:'success'|'failure'|'timed_out'|'cancelled'|'skipped'|'neutral'|'action_required'|'startup_failure'|'stale'|'running'|'queued'|'unknown';label:string};
const finalRunStatuses:Record<string,RunStatus>={success:{icon:'success',label:'Success'},failure:{icon:'failure',label:'Failure'},timed_out:{icon:'timed_out',label:'Timed out'},cancelled:{icon:'cancelled',label:'Cancelled'},skipped:{icon:'skipped',label:'Skipped'},neutral:{icon:'neutral',label:'Neutral'},action_required:{icon:'action_required',label:'Action required'},startup_failure:{icon:'startup_failure',label:'Startup failure'},stale:{icon:'stale',label:'Stale'}};
export function runStatus(run:ActionRun):RunStatus{
 if(run.status==='completed')return finalRunStatuses[run.conclusion||'']||{icon:'unknown',label:'Unknown result'};
 if(run.status==='in_progress')return {icon:'running',label:'In progress'};
 return activeRun(run)?{icon:'queued',label:'Queued / waiting'}:{icon:'unknown',label:'Unknown state'};
}
function elapsed(start:number,end:number):string|null{
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
 const seconds=Math.floor((end-start)/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60;
 return `${hours?`${hours}h `:''}${hours||minutes?`${minutes}m `:''}${seconds%60}s`;
}
export function runElapsed(run:ActionRun,now=Date.now()):string|null{
 const start=Date.parse(run.run_started_at||'');
 // A completed run's last status update is the available run-level end time.
 const end=run.status==='completed'?Date.parse(run.updated_at):activeRun(run)?now:NaN;
 return elapsed(start,end);
}
export function actionsElapsed(input:readonly ActionRun[],now=Date.now()):string|null{
 const byId=new Map<number,ActionRun>();for(const run of input)if(newerRun(byId.get(run.id),run))byId.set(run.id,run);
 const runs=[...byId.values()];if(!runs.length||runs.some(run=>runElapsed(run,now)===null))return null;
 const start=Math.min(...runs.map(run=>Date.parse(run.run_started_at!)));
 const end=runs.some(activeRun)?now:Math.max(...runs.map(run=>Date.parse(run.updated_at)));
 return elapsed(start,end);
}
