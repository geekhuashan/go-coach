import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import worker from '../worker.mjs';
import {authenticated,cookies,makeSession} from '../auth.mjs';

const SOURCE=readFileSync(new URL('../family-entry.mjs',import.meta.url),'utf8');
function entry(env,backend=worker){
  const context={Request,Response,Headers,makeSession,worker:backend,WorkerEntrypoint:class {constructor(){this.env=env;this.ctx={};}}};
  runInNewContext(SOURCE.replace(/^import .*;\n/gm,'').replace('export class FamilyGo','class FamilyGo').replace('export default worker;','globalThis.defaultWorker=worker;globalThis.NamedEntry=FamilyGo;'),context);
  assert.equal(context.defaultWorker,backend);
  return new context.NamedEntry();
}
const secretEnv=()=>({HOUSEHOLD_ID:'synthetic-family',SESSION_SECRET:'synthetic-go-secret-for-private-binding-tests'});
const req=(path,options={})=>new Request('https://xixi.example'+path,options);
class D1 {
  constructor(){this.db=new DatabaseSync(':memory:');for(const file of ['0001_family.sql','0002_statistics.sql','0003_catalog_sync.sql'])this.db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));}
  prepare(sql){
    const db=this.db,statement=args=>({
      async first(){return db.prepare(sql).get(...args)||null;},
      async all(){return {results:db.prepare(sql).all(...args)};},
      async run(){return this._execute();},
      _execute(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};},
    });
    return {...statement([]),bind(...args){return statement(args);}};
  }
  async batch(statements){this.db.exec('BEGIN');try{const result=statements.map(value=>value._execute());this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}

test('private binding signs a short-lived internal session and returns only learner cookies',async()=>{
  const env=secretEnv();let seen;
  const privateEntry=entry(env,{async fetch(request){
    seen=request;assert.equal(await authenticated(request,env),true);
    const headers=new Headers();headers.append('Set-Cookie','go_session=must-not-escape; Path=/');headers.append('Set-Cookie','go_profile=child; Path=/; HttpOnly');headers.append('Set-Cookie','unrelated=no; Path=/');
    return new Response('private',{headers});
  }});
  const response=await privateEntry.fetch(req('/api/state',{headers:{Cookie:'love_almanac=private; go_session=forged; go_profile=child',Authorization:'forged','X-Go-Authenticated':'forged','X-Family-User':'forged'}}));
  assert.equal(cookies(seen).go_profile,'child');
  assert.equal(cookies(seen).love_almanac,undefined);
  for(const name of ['Authorization','X-Go-Authenticated','X-Family-User'])assert.equal(seen.headers.get(name),null);
  const payload=JSON.parse(Buffer.from(cookies(seen).go_session.split('.')[0],'base64url'));
  assert.equal(payload.household,env.HOUSEHOLD_ID);assert.ok(payload.exp>Date.now());assert.ok(payload.exp<=Date.now()+60_000);
  assert.deepEqual(response.headers.getSetCookie(),['go_profile=child; Path=/; HttpOnly']);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});

test('default entry does not accept claimed household identity and deployment keeps it separate',async()=>{
  const env={...secretEnv(),DB:{prepare(){throw Error('unauthorized request must not touch D1');}}};
  for(const headers of [{'X-Family-Authenticated':'true','X-Go-Authenticated':'true'},{Cookie:'love_almanac=forged; go_session=forged'}]){
    assert.equal((await worker.fetch(req('/api/state',{headers}),env)).status,401);
    assert.deepEqual(await(await worker.fetch(req('/api/session',{headers}),env)).json(),{authenticated:false,cloud:true});
  }
  const config=JSON.parse(readFileSync(new URL('../../wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(config.main,'cloud/family-entry.mjs');assert.equal(config.workers_dev,false);assert.deepEqual(config.routes,[]);
});

test('family entry preserves both existing learners, selected profile and learning records',async()=>{
  const env={...secretEnv(),DB:new D1()};const session=await makeSession(env);
  const direct=async(path,options={})=>worker.fetch(req(path,{...options,headers:{...options.headers,Cookie:'go_session='+session+(options.headers?.Cookie?'; '+options.headers.Cookie:'')}}),env);
  let parent=await(await direct('/api/state')).json();
  // Prepare a real synthetic attempt through the existing behavior, before SSO.
  parent=await(await direct('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'play',x:2,y:4,revision:parent.revision,expected_profile_id:'parent'})})).json();
  assert.equal(parent.recent_attempts.length,1);
  const before=env.DB.db.prepare('SELECT id,state_json,helped_json,runs_json FROM profiles ORDER BY id').all();
  const privateEntry=entry(env);
  const child=await(await privateEntry.fetch(req('/api/state',{headers:{Cookie:'go_profile=child'}}))).json();
  assert.equal(child.profile.id,'child');assert.equal(child.recent_attempts.length,0);
  const restoredParent=await(await privateEntry.fetch(req('/api/state',{headers:{Cookie:'go_profile=parent'}}))).json();
  assert.equal(restoredParent.profile.id,'parent');assert.deepEqual(restoredParent.recent_attempts,parent.recent_attempts);assert.deepEqual(restoredParent.board,parent.board);
  assert.deepEqual(restoredParent.profiles.map(value=>value.id).sort(),['child','parent']);
  assert.deepEqual(env.DB.db.prepare('SELECT id,state_json,helped_json,runs_json FROM profiles ORDER BY id').all(),before);
  const switchResponse=await privateEntry.fetch(req('/api/action',{method:'POST',headers:{Cookie:'go_profile=child','Content-Type':'application/json'},body:JSON.stringify({type:'switch_profile',profile_id:'parent',expected_profile_id:'child',revision:child.revision})}));
  assert.equal(switchResponse.status,200);assert.match(switchResponse.headers.get('Set-Cookie'),/^go_profile=parent/);assert.doesNotMatch(switchResponse.headers.get('Set-Cookie'),/go_session/);
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n,1);
  env.DB.db.close();
});
