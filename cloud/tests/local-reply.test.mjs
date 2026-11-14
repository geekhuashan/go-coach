import test from 'node:test';
import assert from 'node:assert/strict';
import {lessonRegion,inRegion,localFallbackMove} from '../local-reply.mjs';
import {bridge} from '../worker.mjs';

const empty=size=>Array.from({length:size},()=>Array(size).fill(0));
function corner(){const board=empty(19);board[0][0]=2;board[0][1]=2;board[1][0]=2;board[1][2]=1;board[2][1]=1;board[0][3]=1;return board;}

test('a problem region covers only empty points next to the stones',()=>{
 const region=lessonRegion({size:19,board:corner()});
 assert.ok(region.length>0&&region.length<30);
 assert.ok(region.every(p=>p.x<=5&&p.y<=4));
 assert.equal(inRegion(region,{x:15,y:15}),false);
 assert.equal(inRegion(region,{pass:true}),false);
 assert.equal(inRegion(region,region[0]),true);
 assert.equal(lessonRegion({size:9,board:empty(9)}),null);
});

test('the rule fallback captures a stone in atari instead of playing elsewhere',()=>{
 const board=empty(19);board[5][5]=1;board[5][4]=2;board[5][6]=2;board[4][5]=2;board[8][8]=1;
 const state={size:19,board,to_play:2,history:[],last_move:{x:8,y:8}};
 assert.deepEqual(localFallbackMove(state,lessonRegion(state)),{x:5,y:6});
});

test('the worker keeps a problem reply local even if an engine ignores the region',async()=>{
 const board=corner(),sent=[];
 const state={size:19,board,initial_board:board,moves:[],to_play:2,initial_player:1,revision:3,mode:'lesson',lesson:{id:'x',sequence:true,objective:{kind:'capture'}},lesson_attempted:true,lesson_progress:{status:'unlisted'},history:[]};
 const env={ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'t'.repeat(40)};
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{sent.push(JSON.parse(init.body).state);return new Response(JSON.stringify({x:15,y:15}),{status:200,headers:{'Content-Type':'application/json'}});};
 try{
  const reply=await bridge(env,'move',state);
  assert.ok(Array.isArray(sent[0].region)&&sent[0].region.length>0);
  assert.equal(reply.local_fallback,true);assert.ok(reply.x<=5&&reply.y<=4);
  // A free game keeps the whole board.
  sent.length=0;const game=await bridge(env,'move',{...state,mode:'free',lesson:null});
  assert.equal(sent[0].region,undefined);assert.deepEqual([game.x,game.y],[15,15]);
 }finally{globalThis.fetch=original;}
});
