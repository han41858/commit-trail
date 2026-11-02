import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readRepositoryLocation,monitorShareURL,repositoryLocationURL,repositoryLocationKey} from './repositoryLocation';

const base='https://example.test/app';
test('an ordinary repository query keeps single mode and uses the existing address normalization',()=>{
 assert.deepEqual(readRepositoryLocation(`${base}?repo=Owner%2FRepo`),{mode:'single',repositories:['owner/repo']});
 assert.deepEqual(readRepositoryLocation(`${base}?repo=https%3A%2F%2Fgithub.com%2FOwner%2FRepo.git`),{mode:'single',repositories:['owner/repo']});
});
test('repeated repositories enter monitor mode and retain normalized URL order',()=>{
 assert.deepEqual(readRepositoryLocation(`${base}?repo=B%2FTwo&repo=a%2Fone&repo=b%2Ftwo`),{mode:'monitor',repositories:['b/two','a/one']});
});
test('explicit monitor mode supports one repository, and repeated duplicates still express monitor intent',()=>{
 for(const query of ['repo=a/one&mode=monitor','repo=A/ONE&repo=a/one','repo=invalid&repo=a/one'])assert.deepEqual(readRepositoryLocation(`${base}?${query}`),{mode:'monitor',repositories:['a/one']});
 assert.equal(readRepositoryLocation(`${base}?repo=a/one&mode=other`).mode,'single');
});
test('invalid repositories are discarded and the first four distinct valid names are kept',()=>{
 const url=new URL(base);for(const repo of ['','bad','../invalid','a/one','a/one','b/two','c/three','d/four','e/five'])url.searchParams.append('repo',repo);
 assert.deepEqual(readRepositoryLocation(url.href),{mode:'monitor',repositories:['a/one','b/two','c/three','d/four']});
 for(const query of ['','repo=bad&mode=monitor','repo=bad&repo=../invalid','mode=monitor'])assert.deepEqual(readRepositoryLocation(`${base}?${query}`),{mode:'single',repositories:[]});
});
test('share URLs contain only ordered repositories and an explicit one-repository monitor flag',()=>{
 const multiple=new URL(monitorShareURL(base,['B/Two','a/one','b/two']));assert.deepEqual([...multiple.searchParams],[['repo','b/two'],['repo','a/one']]);
 const single=new URL(monitorShareURL(base,['a/one']));assert.deepEqual([...single.searchParams],[['repo','a/one'],['mode','monitor']]);
 assert.deepEqual(readRepositoryLocation(single.href),{mode:'monitor',repositories:['a/one']});
});
test('copying a configuration excludes credentials, debug, settings and fragments from the source URL',()=>{
 const url=new URL(monitorShareURL('https://user:private-value@example.test/app?repo=old/name&debug=1&token=private-value&auth=private-value&interval=30&scroll=200#private-value',['private/repo','public/repo']));
 assert.equal(url.origin,'https://example.test');assert.equal(url.pathname,'/app');assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(url.hash,'');
 assert.deepEqual([...url.searchParams.keys()],['repo','repo']);assert.ok(!url.href.includes('private-value'));assert.deepEqual(url.searchParams.getAll('repo'),['private/repo','public/repo']);
});
test('share URLs normalize and cap selections, reject empty configurations and unsupported schemes',()=>{
 const url=monitorShareURL(base,['https://github.com/A/ONE.git','bad','b/two','c/three','d/four','e/five']);assert.equal(readRepositoryLocation(url).repositories.length,4);
 assert.throws(()=>monitorShareURL(base,[]));assert.throws(()=>monitorShareURL(base,['invalid']));assert.throws(()=>monitorShareURL('javascript:alert(1)',['a/one']));
});
test('in-app navigation preserves existing non-routing context and removes stale repository or mode fields',()=>{
 const url=repositoryLocationURL(`${base}?debug=1&repo=old/one&repo=old/two&mode=monitor#context`,{mode:'single',repositories:['new/one']});
 assert.equal(url.searchParams.get('debug'),'1');assert.equal(url.hash,'#context');assert.deepEqual(url.searchParams.getAll('repo'),['new/one']);assert.equal(url.searchParams.has('mode'),false);
 assert.deepEqual(readRepositoryLocation(url.href),{mode:'single',repositories:['new/one']});
});
test('normalized configurations round-trip without confusing single mode, monitor mode or order',()=>{
 const cases=[{mode:'single' as const,repositories:[]},{mode:'single' as const,repositories:['a/one']},{mode:'monitor' as const,repositories:['a/one']},{mode:'monitor' as const,repositories:['b/two','a/one']}];
 for(const value of cases)assert.deepEqual(readRepositoryLocation(repositoryLocationURL(base,value).href),value);
 assert.equal(new Set(cases.map(repositoryLocationKey)).size,cases.length);
});
test('branch parameters preserve case and indexed empty positions across filtering and deduplication',()=>{
 const value=readRepositoryLocation(`${base}?repo=bad&repo=A/One&repo=a/one&repo=B/Two&branch=ignored&branch=Feature%2FFix&branch=duplicate&branch=Dev`);
 assert.deepEqual(value,{mode:'monitor',repositories:['a/one','b/two'],branches:['Feature/Fix','Dev']});
 assert.deepEqual(readRepositoryLocation(`${base}?repo=a/one&repo=b/two&branch=&branch=Dev`),{mode:'monitor',repositories:['a/one','b/two'],branches:[undefined,'Dev']});
});
test('share links round-trip Unicode, slash and special ref characters with no sensitive context',()=>{
 const branches=['Feature/日本語+Fix',undefined,'release|test'];
 const url=monitorShareURL(`${base}?branch=old&token=secret#context`,['a/one','b/two','c/three'],branches);
 assert.deepEqual(readRepositoryLocation(url),{mode:'monitor',repositories:['a/one','b/two','c/three'],branches});assert.ok(!url.includes('secret'));
 assert.deepEqual(new URL(url).searchParams.getAll('branch'),['Feature/日本語+Fix','','release|test']);
});
test('invalid branch values do not shift other repository selections or block valid repositories',()=>{
 const value=readRepositoryLocation(`${base}?repo=a/one&repo=b/two&repo=c/three&branch=bad..ref&branch=Dev&branch=`);
 assert.deepEqual(value,{mode:'monitor',repositories:['a/one','b/two','c/three'],branches:[undefined,'Dev']});
 assert.deepEqual(readRepositoryLocation(`${base}?repo=a/one&branch=bad%20name`),{mode:'single',repositories:['a/one']});
});
test('routing removes stale branches, keeps mode intent and uses branch-sensitive unambiguous keys',()=>{
 const next={mode:'single' as const,repositories:['a/one'],branches:['Dev']};
 const url=repositoryLocationURL(`${base}?repo=old/repo&branch=old&branch=stale&debug=1`,next);
 assert.deepEqual(url.searchParams.getAll('branch'),['Dev']);assert.equal(url.searchParams.get('debug'),'1');assert.deepEqual(readRepositoryLocation(url.href),next);
 assert.notEqual(repositoryLocationKey(next),repositoryLocationKey({...next,branches:['dev']}));
 assert.deepEqual(readRepositoryLocation(monitorShareURL(base,['a/one'],['Dev'])),{...next,mode:'monitor'});
});
test('writers keep branch associations while normalizing invalid and repeated repository inputs',()=>{
 const url=monitorShareURL(base,['bad','A/One','a/one','b/two','c/three','d/four','e/five'],['bad','One','duplicate','Two',undefined,'Four','Five']);
 assert.deepEqual(readRepositoryLocation(url),{mode:'monitor',repositories:['a/one','b/two','c/three','d/four'],branches:['One','Two',undefined,'Four']});
});
