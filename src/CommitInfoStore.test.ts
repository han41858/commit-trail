import {test} from 'node:test';import assert from 'node:assert/strict';import {CommitInfoStore} from './CommitInfoStore';
import {commitVersionIcons} from './graphView';
const response=(data:unknown,next=false)=>new Response(JSON.stringify(data),{headers:next?{Link:'<https://api.github.com/next>; rel="next"'}:{}});
const run=(id:number,status='in_progress',attempt=1,sha='a')=>({id,workflow_id:id,name:'Build',head_sha:sha,status,conclusion:status==='completed'?'success':null,run_attempt:attempt,updated_at:`2026-10-30T00:00:0${attempt}Z`,html_url:'https://github.com/a/b/actions/runs/'+id});
async function using(handler:(url:URL)=>Response|undefined|Promise<Response|undefined>,check:(store:CommitInfoStore,requests:URL[])=>Promise<void>){const old=fetch,store=new CommitInfoStore(),requests:URL[]=[];try{globalThis.fetch=async input=>{const url=new URL(String(input));requests.push(url);const result=await handler(url);if(result)return result;if(url.pathname.endsWith('/actions/runs'))return response({workflow_runs:[]});if(url.pathname.endsWith('/tags')||url.pathname.endsWith('/releases'))return response([]);throw new Error('Unexpected metadata request '+url.pathname);};await check(store,requests);}finally{store.cancel();globalThis.fetch=old;}}
test('tags and releases paginate, deduplicate and resolve nested annotated tags without target_commitish guesses',async()=>{
 await using(url=>{const page=url.searchParams.get('page');if(url.pathname.endsWith('/tags'))return page==='1'?response([{name:'v1',commit:{sha:'a'}},{name:'alias',commit:{sha:'a'}}],true):response([{name:'v1',commit:{sha:'a'}},{name:'v2',commit:{sha:'b'}}]);if(url.pathname.endsWith('/releases'))return response([{id:1,name:'RC',tag_name:'rc',prerelease:true,draft:false,published_at:'2026-10-30',html_url:'https://github.com/a/b/releases/tag/rc'},{id:2,name:'Draft',tag_name:'v1',prerelease:false,draft:true,html_url:'https://github.com/a/b/releases/tag/v1'}]);if(url.pathname.endsWith('/git/ref/tags/rc'))return response({object:{type:'tag',sha:'t1'}});if(url.pathname.endsWith('/git/tags/t1'))return response({object:{type:'tag',sha:'t2'}});if(url.pathname.endsWith('/git/tags/t2'))return response({object:{type:'commit',sha:'a'}});},async(store,requests)=>{
  await store.open('a/b','');const first=store.getSnapshot().bySha.get('a')!;assert.equal(first.tags.length,3);assert.equal(first.releases.length,2);await store.refresh(true);assert.ok(store.getSnapshot().bySha.has('b'));assert.equal(store.getSnapshot().bySha.get('a')!.tags.filter(t=>t.name==='v1').length,1);assert.equal(requests.filter(u=>u.pathname.endsWith('/git/tags/t2')).length,1);
 });
});
test('metadata refresh switches the graph version icon without discarding details or adding requests',async()=>{
 let phase=0;
 await using(url=>{
  if(url.pathname.endsWith('/tags'))return response(phase===3?[]:[{name:'v1',commit:{sha:'a'}},{name:'alias',commit:{sha:'a'}}]);
  if(url.pathname.endsWith('/releases'))return response(phase===1?[{id:1,name:'Version 1',tag_name:'v1',html_url:'https://github.com/a/b/releases/tag/v1'},{id:2,name:'Alias release',tag_name:'alias',html_url:'https://github.com/a/b/releases/tag/alias'}]:[]);
 },async(store,requests)=>{
  await store.open('a/b','');
  const expected=['🏷️','🚀','🏷️',undefined];
  for(phase=0;phase<expected.length;phase++){
   if(phase)await store.refresh();
   const info=store.getSnapshot().bySha.get('a'),count=requests.length;
   assert.deepEqual(commitVersionIcons(info,48),expected[phase]?[{text:expected[phase],x:28,title:phase===1?'Version 1 · Alias release':'v1 · alias'}]:[]);
   if(phase<3)assert.deepEqual(info!.tags.map(tag=>tag.name),['v1','alias']);
   assert.equal(info?.releases.length||0,phase===1?2:0);
   assert.equal(requests.length,count);
   assert.deepEqual(requests.slice(phase*3).map(url=>url.pathname).sort(),['/repos/a/b/actions/runs','/repos/a/b/releases','/repos/a/b/tags']);
  }
 });
});
test('completed runs stop Job requests; a new attempt resumes tracking with latest jobs only',async()=>{
 let current=run(1);await using(url=>{if(url.pathname.endsWith('/actions/runs'))return response({workflow_runs:[current]});if(url.pathname.endsWith('/jobs'))return response({total_count:2,jobs:[{id:1,run_id:1,run_attempt:current.run_attempt,status:'completed',conclusion:'success'},{id:2,run_id:1,run_attempt:current.run_attempt,status:'queued',conclusion:null}]});},async(store,requests)=>{
  await store.open('a/b','');await store.inspect('a');assert.equal(store.getSnapshot().bySha.get('a')!.actions!.ratio,.5);const count=()=>requests.filter(u=>u.pathname.endsWith('/jobs')).length;const before=count();
  current=run(1,'completed');await store.refresh();await store.refresh();assert.equal(count(),before);assert.equal(store.getSnapshot().bySha.get('a')!.actions!.state,'success');
  current=run(1,'in_progress',2);await store.refresh();assert.ok(count()>before);assert.equal(store.getSnapshot().jobs.get(1)!.attempt,2);assert.equal(store.getSnapshot().bySha.get('a')!.runs.length,1);
 });
});
test('past commits use exact head_sha lookup; mismatching PR merge SHA is never attached',async()=>{
 await using(url=>url.searchParams.has('head_sha')?response({workflow_runs:[run(3,'completed',1,'temporary-merge')]}):undefined,async(store,requests)=>{await store.open('a/b','');assert.equal(store.getSnapshot().checked.has('old'),false);await store.inspect('old');assert.equal(store.getSnapshot().checked.has('old'),true);assert.equal(store.getSnapshot().bySha.has('old'),false);assert.equal(store.getSnapshot().bySha.has('temporary-merge'),false);const count=requests.length;await store.inspect('old');assert.equal(requests.length,count);});
});
test('Actions permission errors preserve tags and distinguish denial from empty history',async()=>{
 await using(url=>url.pathname.endsWith('/actions/runs')?new Response('{}',{status:403}):url.pathname.endsWith('/tags')?response([{name:'v1',commit:{sha:'a'}}]):undefined,async store=>{await store.open('a/b','test');assert.match(store.getSnapshot().errors.actions,/Actions: Read-only/);assert.equal(store.getSnapshot().bySha.get('a')!.tags.length,1);assert.equal(store.getSnapshot().checked.size,0);});
});
test('repository change cancels pending metadata and cannot leak a late result',async()=>{
 let release!:(r:Response)=>void;await using(url=>url.pathname.includes('/old/')&&url.pathname.endsWith('/tags')?new Promise(resolve=>{release=resolve;}):undefined,async store=>{const old=store.open('old/repo','');await new Promise(resolve=>setImmediate(resolve));await store.open('new/repo','');release(response([{name:'private',commit:{sha:'secret'}}]));await old;assert.equal(store.getSnapshot().repo,'new/repo');assert.equal(store.getSnapshot().bySha.has('secret'),false);});
});
test('partial or failed version lists retain cached tags until the full catalog is known',async()=>{
 let phase=0;await using(url=>{if(!url.pathname.endsWith('/tags'))return;const page=url.searchParams.get('page');if(!phase)return response([{name:'old',commit:{sha:'old'}}]);if(page==='1')return response([{name:'new',commit:{sha:'new'}}],true);if(phase===1)return new Response('',{status:500});return response([]);},async store=>{await store.open('a/b','');phase=1;await store.refresh();assert.ok(store.getSnapshot().bySha.has('old'));await store.refresh(true);assert.ok(store.getSnapshot().bySha.has('old'));phase=2;await store.refresh(true);assert.ok(!store.getSnapshot().bySha.has('old'));assert.ok(store.getSnapshot().bySha.has('new'));});
});
test('jobs paginate and deduplicate IDs without inflating the completion ratio',async()=>{
 await using(url=>{if(url.pathname.endsWith('/actions/runs'))return response({workflow_runs:[run(1)]});if(url.pathname.endsWith('/jobs')){const job={id:1,run_id:1,status:'completed',conclusion:'success'};return url.searchParams.get('page')==='1'?response({total_count:2,jobs:[job]},true):response({total_count:2,jobs:[job,{id:2,run_id:1,status:'queued',conclusion:null}]});}},async store=>{await store.open('a/b','');await store.inspect('a');assert.equal(store.getSnapshot().bySha.get('a')!.actions!.ratio,.5);assert.equal(store.getSnapshot().jobs.get(1)!.jobs.length,2);});
});
test('older selected-run pages remain partial and can resume rather than restart indefinitely',async()=>{
 await using(url=>{if(url.pathname.endsWith('/actions/runs')&&url.searchParams.has('head_sha')){const page=Number(url.searchParams.get('page'));return response({workflow_runs:[run(page,'completed',1,'old')]},page<4);}},async(store,requests)=>{await store.open('a/b','');await store.inspect('old');assert.equal(store.getSnapshot().checked.has('old'),false);assert.equal(store.getSnapshot().more,true);await store.refresh(true);assert.equal(store.getSnapshot().checked.has('old'),true);assert.equal(store.getSnapshot().bySha.get('old')!.runs.length,4);assert.equal(requests.filter(url=>url.searchParams.has('head_sha')&&url.searchParams.get('page')==='1').length,1);});
});
test('active runs that leave the recent list reach a final state without polling completed details',async()=>{
 let recent=true;await using(url=>{
  if(url.pathname.endsWith('/actions/runs'))return response({workflow_runs:recent?[run(1)]:[]});
  if(url.pathname.endsWith('/actions/runs/1'))return response(run(1,'completed'));
  if(url.pathname.endsWith('/jobs'))return response({total_count:1,jobs:[{id:1,run_id:1,status:'in_progress',conclusion:null}]});
 },async(store,requests)=>{
  await store.open('a/b','');store.watch(['a']);await store.refresh();recent=false;await store.refresh();
  assert.equal(store.getSnapshot().bySha.get('a')!.actions!.state,'success');const jobs=requests.filter(url=>url.pathname.endsWith('/jobs')).length;
  await store.refresh();assert.equal(requests.filter(url=>url.pathname.endsWith('/actions/runs/1')).length,1);assert.equal(requests.filter(url=>url.pathname.endsWith('/jobs')).length,jobs);
 });
});
test('failed release tag resolution is retried and unchanged tag details stay cached',async()=>{
 let failed=true;await using(url=>{
  if(url.pathname.endsWith('/releases'))return response([{id:1,tag_name:'rc',name:'RC',draft:false,prerelease:true,html_url:'https://github.com/a/b/releases/tag/rc'}]);
  if(url.pathname.endsWith('/git/ref/tags/rc'))return failed?new Response('',{status:500}):response({object:{type:'commit',sha:'a'}});
 },async(store,requests)=>{
  await store.open('a/b','');assert.ok(store.getSnapshot().errors.releases);failed=false;await store.refresh();
  assert.equal(store.getSnapshot().bySha.get('a')!.releases.length,1);assert.equal(store.getSnapshot().errors.releases,undefined);
  await store.refresh();assert.equal(requests.filter(url=>url.pathname.endsWith('/git/ref/tags/rc')).length,2);assert.equal(store.getSnapshot().bySha.get('a')!.releases.length,1);
 });
});
test('loaded catalog pages are revalidated when only an older tag or release changes',async()=>{
 let phase=0;await using(url=>{
  if(url.pathname.endsWith('/tags'))return url.searchParams.get('page')==='1'?response([{name:'new',commit:{sha:'a'}}],true):response(phase?[{name:'old',commit:{sha:'c'}}]:[{name:'old',commit:{sha:'b'}}]);
  if(url.pathname.endsWith('/releases'))return url.searchParams.get('page')==='1'?response([],true):response([{id:1,tag_name:'old',name:phase?'Updated':'Initial',draft:false,prerelease:false,html_url:'https://github.com/a/b/releases/tag/old'}]);
 },async store=>{
  await store.open('a/b','');await store.refresh(true);assert.equal(store.getSnapshot().bySha.get('b')!.releases[0].name,'Initial');phase=1;
  await store.refresh();assert.equal(store.getSnapshot().bySha.has('b'),false);assert.equal(store.getSnapshot().bySha.get('c')!.releases[0].name,'Updated');
 });
});
test('detail scrolling resumes only the selected SHA and skips finished catalogs and unrelated run pages',async()=>{
 await using(url=>{if(url.pathname.endsWith('/actions/runs')){const page=Number(url.searchParams.get('page'));return url.searchParams.has('head_sha')?response({workflow_runs:[run(page,'completed',1,'a')]},page<4):response({workflow_runs:[run(99,'completed',1,'other')]},true);}},async(store,requests)=>{
  await store.open('a/b','');await store.inspect('a');assert.equal(store.getSnapshot().selected,'a');assert.equal(store.getSnapshot().more,true);
  const before=requests.length;await Promise.all([store.loadMore('a'),store.loadMore('a')]);
  const added=requests.slice(before);assert.equal(added.length,1);assert.equal(added[0].searchParams.get('head_sha'),'a');assert.equal(added[0].searchParams.get('page'),'4');
  assert.equal(store.getSnapshot().checked.has('a'),true);assert.equal(store.getSnapshot().bySha.get('a')!.runs.length,4);assert.equal(store.getSnapshot().more,false);
  const done=requests.length;await store.loadMore('a');assert.equal(requests.length,done);
 });
});
test('a draft release with a missing ref does not keep scroll pagination running indefinitely',async()=>{
 await using(url=>url.pathname.endsWith('/releases')?response([{id:1,name:'Draft',tag_name:'missing',draft:true,prerelease:false}]):url.pathname.endsWith('/git/ref/tags/missing')?new Response('{}',{status:404}):undefined,async(store,requests)=>{
  await store.open('a/b','');await store.inspect('a');assert.equal(store.getSnapshot().more,false);const before=requests.length;
  await store.loadMore('a');assert.equal(requests.length,before);assert.equal(requests.filter(url=>url.pathname.endsWith('/git/ref/tags/missing')).length,1);
 });
});
test('loading a later catalog page does not clear an earlier refresh failure without checking it',async()=>{
 let failed=false;await using(url=>{
  if(url.pathname.endsWith('/tags'))return failed?new Response('{}',{status:500}):response([]);
  if(url.pathname.endsWith('/releases'))return response([],url.searchParams.get('page')==='1');
 },async(store,requests)=>{
  await store.open('a/b','');await store.inspect('a');failed=true;await store.refresh();const error=store.getSnapshot().errors.tags;assert.ok(error);
  await store.loadMore('a');assert.equal(store.getSnapshot().errors.tags,error);assert.equal(requests.filter(url=>url.pathname.endsWith('/tags')).length,2);assert.equal(store.getSnapshot().more,false);
 });
});
test('a late scroll page cannot change a different repository or its selected SHA',async()=>{
 let release!:(value:Response)=>void;await using(url=>url.pathname.includes('/old/')&&url.pathname.endsWith('/tags')?(url.searchParams.get('page')==='1'?response([],true):new Promise(resolve=>{release=resolve;})):undefined,async store=>{
  await store.open('old/repo','');await store.inspect('a');const pending=store.loadMore('a');await new Promise(resolve=>setImmediate(resolve));
  await store.open('new/repo','');release(response([{name:'private',commit:{sha:'secret'}}]));await pending;
  assert.equal(store.getSnapshot().repo,'new/repo');assert.equal(store.getSnapshot().selected,'');assert.equal(store.getSnapshot().bySha.has('secret'),false);
 });
});
test('a newly selected commit is published together with its pending lookup',async()=>{
 await using(()=>undefined,async store=>{
  await store.open('a/b','');const seen:{selected:string;busy:boolean}[]=[];const stop=store.subscribe(()=>{const state=store.getSnapshot();seen.push({selected:state.selected,busy:state.busy});});
  await store.inspect('new');stop();assert.equal(seen.find(state=>state.selected==='new')?.busy,true);assert.equal(store.getSnapshot().busy,false);
 });
});
test('detail scrolling also resumes an unfinished job list without restarting its first pages',async()=>{
 await using(url=>{
  if(url.pathname.endsWith('/actions/runs'))return response({workflow_runs:[run(1)]});
  if(url.pathname.endsWith('/jobs')){const page=Number(url.searchParams.get('page'));return response({total_count:6,jobs:[{id:page,run_id:1,status:page===1?'in_progress':'queued',conclusion:null}]},page<6);}
 },async(store,requests)=>{
  await store.open('a/b','');await store.inspect('a');assert.equal(store.getSnapshot().jobs.get(1)!.next,6);assert.equal(store.getSnapshot().more,true);
  await store.loadMore('a');assert.equal(store.getSnapshot().jobs.get(1)!.complete,true);assert.equal(store.getSnapshot().more,false);
  assert.deepEqual(requests.filter(url=>url.pathname.endsWith('/jobs')).map(url=>Number(url.searchParams.get('page'))),[1,2,3,4,5,6]);
 });
});
test('known active job counts and cold completed workflows produce a complete commit progress total',async()=>{
 const current=[run(1),run(2,'completed'),run(3,'completed')];
 await using(url=>{
  if(url.pathname.endsWith('/actions/runs'))return response({workflow_runs:current});
  if(url.pathname.endsWith('/jobs')){const id=Number(url.pathname.split('/runs/')[1].split('/')[0]),total=id===3?3:2;return response({total_count:total,jobs:Array.from({length:total},(_,index)=>({id:id*10+index,run_id:id,run_attempt:1,status:id===1&&index===1?'in_progress':'completed',conclusion:id===1&&index===1?null:'success'}))});}
 },async(store,requests)=>{
  await store.open('a/b','');await store.inspect('a');assert.deepEqual(store.getSnapshot().bySha.get('a')!.actions,{state:'running',done:6,total:7,ratio:6/7});
  await store.refresh();await store.refresh();await store.inspect('a');
  for(const id of [2,3])assert.equal(requests.filter(url=>url.pathname.includes(`/runs/${id}/`)&&url.pathname.endsWith('/jobs')).length,1);
  assert.equal(requests.filter(url=>url.pathname.includes('/runs/1/')&&url.pathname.endsWith('/jobs')).length,3);
 });
});
test('a finished workflow gets one final snapshot while its sibling remains active, then stops polling',async()=>{
 let phase=0;await using(url=>{
  if(url.pathname.endsWith('/actions/runs'))return response({workflow_runs:[run(1,phase===2?'completed':'in_progress'),run(2,phase?'completed':'in_progress')]});
  if(url.pathname.endsWith('/jobs')){const id=Number(url.pathname.split('/runs/')[1].split('/')[0]);return response({total_count:2,jobs:[{id:id*10,run_id:id,status:'completed',conclusion:'success'},{id:id*10+1,run_id:id,status:phase&&id===2?'completed':'in_progress',conclusion:phase&&id===2?'success':null}]});}
 },async(store,requests)=>{
  await store.open('a/b','');await store.inspect('a');assert.equal(store.getSnapshot().bySha.get('a')!.actions!.ratio,.5);
  phase=1;await store.refresh();assert.equal(store.getSnapshot().bySha.get('a')!.actions!.ratio,.75);
  await store.refresh();assert.equal(requests.filter(url=>url.pathname.includes('/runs/2/')&&url.pathname.endsWith('/jobs')).length,2);
  const before=requests.filter(url=>url.pathname.endsWith('/jobs')).length;phase=2;await store.refresh();assert.equal(requests.filter(url=>url.pathname.endsWith('/jobs')).length,before);assert.equal(store.getSnapshot().bySha.get('a')!.actions!.state,'success');
 });
});
test('a failed completed snapshot remains unknown and retries once per later refresh',async()=>{
 let recovered=false;await using(url=>{
  if(url.pathname.endsWith('/actions/runs'))return response({workflow_runs:[run(1),run(2,'completed')]});
  if(url.pathname.endsWith('/jobs')){const id=Number(url.pathname.split('/runs/')[1].split('/')[0]);if(id===2&&!recovered)return new Response('{}',{status:500});return response({total_count:2,jobs:[{id:id*10,run_id:id,status:'completed',conclusion:'success'},{id:id*10+1,run_id:id,status:id===1?'in_progress':'completed',conclusion:id===1?null:'success'}]});}
 },async(store,requests)=>{
  const count=()=>requests.filter(url=>url.pathname.includes('/runs/2/')&&url.pathname.endsWith('/jobs')).length;
  await store.open('a/b','');await store.inspect('a');assert.equal(count(),1);assert.equal(store.getSnapshot().bySha.get('a')!.actions!.ratio,null);
  await store.refresh();assert.equal(count(),2);assert.ok(store.getSnapshot().errors['jobs:2']);
  recovered=true;await store.refresh();assert.equal(count(),3);assert.equal(store.getSnapshot().bySha.get('a')!.actions!.ratio,.75);assert.equal(store.getSnapshot().errors['jobs:2'],undefined);
  await store.refresh();assert.equal(count(),3);
 });
});
test('closing commit details clears the metadata selection and reuses cached data when reopened',async()=>{
 await using(url=>url.pathname.endsWith('/actions/runs')?response({workflow_runs:[run(1,'completed')]}):undefined,async(store,requests)=>{
  await store.open('a/b','');await store.inspect('a');const cached=store.getSnapshot().bySha,count=requests.length;
  store.clearSelection();assert.equal(store.getSnapshot().selected,'');assert.equal(store.getSnapshot().bySha,cached);assert.equal(store.getSnapshot().checked.has('a'),true);
  await store.inspect('a');assert.equal(store.getSnapshot().selected,'a');assert.equal(store.getSnapshot().bySha,cached);assert.equal(requests.length,count);
 });
});
test('a lookup that finishes after details close caches its result without restoring selection',async()=>{
 let finish!:(value:Response)=>void;
 await using(url=>url.searchParams.get('head_sha')==='old'?new Promise<Response>(resolve=>{finish=resolve;}):undefined,async store=>{
  await store.open('a/b','');const pending=store.inspect('old');await new Promise(resolve=>setImmediate(resolve));
  store.clearSelection();assert.equal(store.getSnapshot().selected,'');finish(response({workflow_runs:[run(1,'completed',1,'old')]}));await pending;
  assert.equal(store.getSnapshot().selected,'');assert.equal(store.getSnapshot().bySha.has('old'),true);assert.equal(store.getSnapshot().checked.has('old'),true);
 });
});
