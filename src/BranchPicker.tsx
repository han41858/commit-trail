import {useEffect,useRef,useState} from 'react';
import {History,type HistorySnapshot} from './history';
import {useRetryCountdown,retryLabel} from './useRetryCountdown';
import {mergedCount,preferredBranch,recommendBranches} from './recommendations';

export function BranchPicker({history,state,onPicked}:{history:History;state:HistorySnapshot;onPicked:(name:string)=>void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');
 const container=useRef<HTMLDivElement>(null);
 const retrySeconds=useRetryCountdown(state.ranking.retryAt);
 useEffect(()=>{if(open)void history.loadRecommendations();},[open,state.repo,history]);
 useEffect(()=>{setOpen(false);setQuery('');},[state.repo]);
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))setOpen(false);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);container.current?.querySelector('button')?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open]);
 const recommended=recommendBranches(state.branches,state.ranking.counts,state.meta?.default_branch||'');
 const preferred=preferredBranch(state.branches,state.meta?.default_branch||'');
 const search=query.trim();
 const matches=state.branches.filter(b=>b.name.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name));
 const shown=search?matches.slice(0,50):recommended;
 function choose(name:string){setOpen(false);if(name===state.base)return;void history.chooseBase(name);onPicked(name);}
 async function find(){if(!search)return;if(await history.findBranch(search)){if(history.getSnapshot().repo===state.repo&&history.getSnapshot().base!==state.base)onPicked(history.getSnapshot().base);setOpen(false);}}
 return <div className="base-picker branch-picker" ref={container}>
  <button id="base-branch" className="branch-trigger" aria-label="Branch" aria-expanded={open} aria-controls="branch-menu" disabled={!state.branches.length} onClick={()=>setOpen(!open)}><span><span className="base-prefix">Branch: </span>{state.base||'Choose a branch'}</span><span aria-hidden="true">⌄</span></button>
  {open&&<section className="branch-menu floating-panel" id="branch-menu" aria-label="Choose branch">
   <form onSubmit={e=>{e.preventDefault();void find();}}><input autoFocus aria-label="Search all branches" placeholder="Search or enter any branch name" value={query} onChange={e=>setQuery(e.target.value)}/>{search&&<button disabled={state.branchSearch.busy} type="submit">{state.branchSearch.busy?'Finding…':'Find exact branch'}</button>}</form>
   <div className="branch-heading">{search?'Matching branches':'Recommended · up to 30'}</div>
   {!search&&<div className="ranking-status" aria-live="polite">{state.ranking.busy?'Counting merged PRs…':state.ranking.error?`PR ranking unavailable. ${state.ranking.error}`:state.ranking.complete?'Merged PRs in the last 90 days':`Partial counts · ${state.ranking.scanned.toLocaleString()} closed PRs checked`}</div>}
   <div className="branch-options">{shown.map(b=>{const count=mergedCount(state.ranking.counts,b.name);return <button key={b.name} className="branch-option" aria-label={`Use branch ${b.name}`} aria-pressed={state.base===b.name} onClick={()=>choose(b.name)}><span className="branch-name">{b.name}</span><span className="branch-badges">{b.name===preferred&&<small>Preferred</small>}<small>{state.ranking.complete?`${count} merged`:count?`${count}+ merged`:'—'}</small></span></button>;})}{shown.length===0&&<p>No loaded matches. Enter an exact name to find any branch.</p>}</div>
   {search&&<small className="search-hint">Exact-name lookup includes branches outside this list.{matches.length>50?' Showing the first 50 matches.':''}</small>}
   {state.branchSearch.error&&<p className="branch-search-error" role="status">{state.branchSearch.error}</p>}
   <div className="branch-actions">{!search&&!state.ranking.complete&&<button disabled={state.ranking.busy||retrySeconds>0} onClick={()=>void history.loadRecommendations()}>{retrySeconds?retryLabel(retrySeconds):state.ranking.error?'Retry PR ranking':'Continue PR ranking'}</button>}{state.moreBranches&&<button disabled={state.busy} onClick={()=>void history.loadBranches()}>More branch names</button>}</div>
  </section>}
 </div>;
}
