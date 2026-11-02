import {useLayoutEffect,useRef} from 'react';
import './RefreshButton.css';
import {refreshAnimationStart} from './refreshProgress';

type Props={nextAt:number;interval:number;sweeping:boolean;disabled:boolean;onRefresh:()=>void};
function RefreshFill({nextAt,interval,sweeping}:Pick<Props,'nextAt'|'interval'|'sweeping'>){
 const circle=useRef<SVGCircleElement>(null);
 const active=sweeping&&Number.isFinite(nextAt)&&nextAt>0&&Number.isFinite(interval)&&interval>0;
 useLayoutEffect(()=>{
  if(!active)return;
  // Align after DOM commit, rather than starting a fresh animation after a slow
  // render. DocumentTimeline and performance.now() share the same time origin.
  const align=()=>{
   if(document.hidden)return;
   const animation=circle.current?.getAnimations().find(animation=>animation instanceof CSSAnimation&&animation.animationName==='refresh-sweep');
   if(!animation)return;
   const timelineNow=performance.now(),start=refreshAnimationStart(nextAt,interval,Date.now(),timelineNow);
   if(start!==null)animation.startTime=start;
  };
  align();document.addEventListener('visibilitychange',align);window.addEventListener('online',align);
  return()=>{document.removeEventListener('visibilitychange',align);window.removeEventListener('online',align);};
 },[nextAt,interval,active]);
 return <svg className="refresh-fill" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
   {active&&<circle ref={circle} key={`${nextAt}:${interval}`} cx="50" cy="50" r="50" pathLength="100" transform="rotate(-90 50 50)" fill="none" strokeWidth="100" strokeDasharray="100" style={{animationDuration:`${interval}ms`}}/>}
  </svg>;
}
export function RefreshButton({nextAt,interval,sweeping,disabled,onRefresh}:Props){
 return <button className="refresh-button" aria-label="Refresh repository" title="Refresh repository" disabled={disabled} onClick={onRefresh}>
  <RefreshFill nextAt={nextAt} interval={interval} sweeping={sweeping}/>
  <span className="refresh-symbol" aria-hidden="true">↻</span>
 </button>;
}
export function RefreshTimer({nextAt,interval,sweeping,running,paused,disabled,onRefresh}:Props&{running:boolean;paused:boolean}){
 const label=running?'Refreshing repositories':paused?'Refresh repositories (auto refresh paused)':'Refresh repositories';
 return <button type="button" className="refresh-button monitor-timer" disabled={disabled} onClick={onRefresh} aria-label={label} aria-busy={running} title={label}>
  <RefreshFill nextAt={nextAt} interval={interval} sweeping={sweeping}/><span className="refresh-symbol" aria-hidden="true">↻</span>
 </button>;
}
