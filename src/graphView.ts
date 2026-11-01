import type {HistoryFrontier} from './model';
export const GRAPH_ORIGIN=48,LANE_SPACING=34;
export function visibleHistorySources(frontiers:readonly HistoryFrontier[],positions:ReadonlyMap<string,{x:number;y:number}>,view:{left:number;top:number;width:number;height:number;inset:number},pending:readonly string[]=[]){
 if(view.width<=0||view.height<=view.inset)return [];
 const sources=new Set<string>(),excluded=new Set(pending);
 for(const frontier of frontiers){
  const point=positions.get(frontier.sha);
  if(!point||point.x<view.left||point.x>view.left+view.width||point.y<view.top+view.inset||point.y>view.top+view.height)continue;
  for(const source of frontier.sources)if(!excluded.has(source))sources.add(source);
 }
 return [...sources];
}
export function graphFrame(viewWidth:number,maxLane:number,mobile:boolean){
 const naturalWidth=GRAPH_ORIGIN+maxLane*LANE_SPACING+76;
 const laneSpacing=(available:number)=>maxLane>0?Math.min(LANE_SPACING,Math.max(0,available-GRAPH_ORIGIN-18)/maxLane):LANE_SPACING;
 const gap=mobile?12:16,compactWidth=Math.min(viewWidth/2,naturalWidth);
 // Keep mobile lanes at least 12px apart before reserving space for messages.
 const showMessages=!mobile||laneSpacing(compactWidth)>=12;
 const branchWidth=showMessages?compactWidth:viewWidth,messageX=showMessages?branchWidth+gap:viewWidth;
 return {spacing:laneSpacing(branchWidth),width:viewWidth,branchWidth,showMessages,messageX,messageWidth:showMessages?Math.min(viewWidth/2,Math.max(0,viewWidth-messageX-gap)):0};
}
export function branchDisplayNames(names:readonly string[]){
 const unique=[...new Set(names)],counts=new Map<string,number>();
 for(const name of unique){const parts=name.split('/');for(let start=0;start<parts.length;start++){const suffix=parts.slice(start).join('/');counts.set(suffix,(counts.get(suffix)||0)+1);}}
 return new Map(unique.map(name=>{
  const parts=name.split('/');let short=name;
  for(let start=parts.length-1;start>=0;start--){const suffix=parts.slice(start).join('/');if(counts.get(suffix)===1){short=suffix;break;}}
  return [name,short];
 }));
}
export function branchLabelText(names:readonly string[],display:ReadonlyMap<string,string>,limit:number){
 const suffix=names.length>1?` +${names.length-1}`:'',name=display.get(names[0])||names[0]||'';
 const letters=Array.from(name),available=Math.max(1,limit-suffix.length);
 if(letters.length<=available)return name+suffix;
 return letters.slice(0,available-1).join('')+'…'+suffix;
}
