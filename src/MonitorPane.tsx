import {memo,useCallback,useEffect,useRef,useSyncExternalStore} from 'react';
import type {Commit} from './model';
import type {HistorySnapshot} from './history';
import type {InfoSnapshot} from './CommitInfoStore';
import {Graph} from './Graph';
import {CommitDetails} from './CommitDetails';
import type {MonitorEntry,MonitorSession} from './MonitorSession';
import {useMonitorDetailsPosition} from './useMonitorDetailsPosition';

export function MonitorStatus({state,extras,refreshing,limited}:{state:HistorySnapshot;extras:InfoSnapshot;refreshing:boolean;limited:boolean}){
 const error=state.error||state.refreshError||state.discoveryError||Object.values(extras.errors).join(' · ');
 return <div className="monitor-status"><span>{state.commits.length.toLocaleString()} commits</span>{(state.busy||extras.busy||refreshing)&&<span className="loading-spinner" role="status" aria-label="Loading repository"/>}
  {limited?<p role="status">GitHub rate limit · waiting to retry</p>:error?<p role="alert">{error}</p>:null}
 </div>;
}
export const MonitorPane=memo(function MonitorPane({entry,order,theme,session,refreshing,limited,selected,onSelect,onClose}:{entry:MonitorEntry;order:number;theme:string;session:MonitorSession;refreshing:boolean;limited:boolean;selected:Commit|null;onSelect:(repository:string,commit:Commit)=>void;onClose:()=>void}){
 const state=useSyncExternalStore(entry.history.subscribe,entry.history.getSnapshot),extras=useSyncExternalStore(entry.info.subscribe,entry.info.getSnapshot);
 const pane=useRef<HTMLElement>(null),details=useRef<HTMLElement>(null);
 const detailsPosition=useMonitorDetailsPosition(pane,details,!!selected,selected?.sha||'',order);
 const select=useCallback((commit:Commit)=>{onSelect(entry.repository,commit);details.current?.focus({preventScroll:true});},[entry.repository,onSelect]);
 const loadMore=useCallback((sources?:string[])=>{if(session.canRequest())void entry.history.loadMore(sources);},[entry,session]);
 const watch=useCallback((shas:string[])=>{if(!limited&&session.canRequest())entry.info.watch(shas);},[entry,session,limited,extras.repo]);
 useEffect(()=>{if(extras.repo===entry.repository){if(selected&&!limited)void entry.info.inspect(selected.sha);else if(!selected)entry.info.clearSelection();}},[entry,selected?.sha,extras.repo,limited]);
 useEffect(()=>{
  if(!selected)return;
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&pane.current?.contains(event.target)&&!details.current?.contains(event.target))onClose();};
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[selected,onClose]);
 return <section className="monitor-column" ref={pane} style={{order}} aria-label={`Repository ${entry.repository}`}>
  {state.commits.length>0?<Graph theme={theme} containerResponsive commits={state.commits} branches={state.branches} branch={state.base} reverse={state.reverse} selected={selected?.sha||''} onSelect={select} hasMore={state.more&&!state.error&&!limited} loading={state.busy} onLoadMore={loadMore} frontiers={state.frontiers} pendingSources={state.pendingSources} topInset={34} refreshVersion={state.refreshVersion} baseHead={state.baseHead} info={extras.bySha} onVisible={watch} label={`Commit graph for ${entry.repository}`}/>:<div className="monitor-empty" role="status">{state.busy?'Loading…':state.error?'Repository unavailable':'No commits'}</div>}
  {selected&&<CommitDetails panelRef={details} style={detailsPosition} repository={entry.repository} commit={selected} onClose={onClose} info={extras} onMore={session.canRequest()?entry.info.loadMore:undefined}/>}
  <MonitorStatus state={state} extras={extras} refreshing={refreshing} limited={limited}/>
 </section>;
});
