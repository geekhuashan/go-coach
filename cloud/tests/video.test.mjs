import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
import {makeSession} from '../auth.mjs';
const URL='https://go.example/api/videos/count-liberties.mp4';
function fakeBucket(text='0123456789'){
 const calls=[],data=new TextEncoder().encode(text);
 return {calls,async head(key){calls.push(['head',key]);return {size:data.length,etag:'version-one'};},async get(key,options){calls.push(['get',key,options]);const part=options.range?data.slice(options.range.offset,options.range.offset+options.range.length):data;return {body:new ReadableStream({start(controller){controller.enqueue(part);controller.close();}})};}};
}
async function fixture(bucket=fakeBucket()){
 const env={VIDEOS:bucket,HOUSEHOLD_ID:'test-video-home',SESSION_SECRET:'test-only-video-session-secret-over-thirty-two'};
 Object.defineProperty(env,'DB',{get(){throw new Error('Video requests must never access D1');}});
 const cookie='go_session='+await makeSession(env);
 const request=(method='GET',range=null,url=URL,auth=true)=>worker.fetch(new Request(url,{method,headers:{...(auth?{Cookie:cookie}:{}),...(range!==null?{Range:range}:{})}}),env);
 return {env,bucket,request};
}
test('video authentication precedes R2 and authenticated streaming never reads D1',async()=>{
 const {request,bucket}=await fixture();assert.equal((await request('GET',null,URL,false)).status,401);assert.equal((await request('HEAD',null,URL,false)).status,401);assert.deepEqual(bucket.calls,[]);
 const r=await request();assert.equal(r.status,200);assert.equal(await r.text(),'0123456789');assert.equal(r.headers.get('Content-Type'),'video/mp4');assert.equal(r.headers.get('Content-Length'),'10');assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(r.headers.get('Accept-Ranges'),'bytes');assert.equal(r.headers.get('Location'),null);assert.equal(bucket.calls[0][1],'teaching/count-liberties.mp4');assert.deepEqual(bucket.calls[1][2],{onlyIf:{etagMatches:'version-one'}});
});
test('single byte ranges support closed, open, suffix and clamped requests',async()=>{
 for(const [range,expected,contentRange]of [['bytes=2-4','234','bytes 2-4/10'],['bytes=7-','789','bytes 7-9/10'],['bytes=-3','789','bytes 7-9/10'],['bytes=8-999','89','bytes 8-9/10'],['bytes=-999','0123456789','bytes 0-9/10']]){
  const {request,bucket}=await fixture();const r=await request('GET',range);assert.equal(r.status,206,range);assert.equal(await r.text(),expected,range);assert.equal(r.headers.get('Content-Range'),contentRange);assert.equal(r.headers.get('Content-Length'),String(expected.length));assert.equal(bucket.calls[1][2].range.length,expected.length);
 }
});
test('HEAD mirrors full and ranged headers without fetching an object body',async()=>{
 for(const [range,status,length]of [[null,200,'10'],['bytes=1-3',206,'3'],['bytes=-2',206,'2']]){
  const {request,bucket}=await fixture();const r=await request('HEAD',range);assert.equal(r.status,status);assert.equal(r.headers.get('Content-Length'),length);assert.equal(await r.text(),'');assert.deepEqual(bucket.calls,[['head','teaching/count-liberties.mp4']]);
 }
});
test('invalid, overflowing, zero suffix and multi-ranges return 416 without reading bodies',async()=>{
 for(const range of ['bytes=10-','bytes=9-3','bytes=-0','bytes=-','bytes=0-1,4-5','bytes=0-1, 2-3','bytes=1.5-3','bytes=9007199254740992-','items=0-1']){
  const {request,bucket}=await fixture();const r=await request('GET',range);assert.equal(r.status,416,range);assert.equal(r.headers.get('Content-Range'),'bytes */10');assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(bucket.calls.length,1);
 }
 const {request}=await fixture(fakeBucket(''));assert.equal((await request('GET','bytes=0-')).status,416);
});
test('fixed path validation and method restrictions never access another R2 key',async()=>{
 for(const suffix of ['nested/file.mp4','count%2Fliberties.mp4','%2e%2e.mp4','count-liberties.webm','_private.mp4','a'.repeat(81)+'.mp4']){
  const {request,bucket}=await fixture();assert.equal((await request('GET',null,'https://go.example/api/videos/'+suffix)).status,404,suffix);assert.deepEqual(bucket.calls,[]);
 }
 const {request,bucket}=await fixture();const r=await request('POST');assert.equal(r.status,405);assert.equal(r.headers.get('Allow'),'GET, HEAD');assert.deepEqual(bucket.calls,[]);
});
test('missing binding, absent objects and storage failures are explicit and do not leak details',async()=>{
 let f=await fixture();delete f.env.VIDEOS;assert.equal((await f.request()).status,503);
 f=await fixture({async head(){return null;}});assert.equal((await f.request()).status,404);assert.equal(await (await f.request('HEAD')).text(),'');
 f=await fixture({async head(){return {size:10,etag:'v'};},async get(){return null;}});assert.equal((await f.request()).status,404);
 f=await fixture({async head(){throw new Error('private bucket name and credentials');}});const r=await f.request();assert.equal(r.status,503);assert.ok(!(await r.text()).includes('credentials'));
 f=await fixture({async head(){return {size:10,etag:'v'};},async get(){return {size:11,etag:'changed'};}});assert.equal((await f.request('GET','bytes=0-3')).status,503);
});
