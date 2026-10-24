#!/usr/bin/env node
// Builds per-problem explanations for the household's book lessons and stores them in D1.
// Board facts come from cloud/explain.mjs and the short "why this is right" text is composed
// from them; a language model may only reword that text, and a rewrite that adds, drops or
// moves a fact is rejected in favour of the rule text.
//
//   node scripts/build_explanations.mjs --export            # read lessons from remote D1
//   node scripts/build_explanations.mjs --lessons file.json # or from an exported array
//   options: --no-model  --concurrency 6  --apply (write to remote D1 and read back)
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {explainLesson,EXPLAIN_VERSION} from '../cloud/explain.mjs';
import {ruleWhy,prompt,checkWhy} from './explanation-model.mjs';

const ROOT=new URL('..',import.meta.url).pathname,OUT=ROOT+'.local/explanations/';
const args=process.argv.slice(2),flag=n=>args.includes(n),option=(n,d)=>{const i=args.indexOf(n);return i>=0?args[i+1]:d;};
const DB='go-coach-wnam',HOUSEHOLD='home';
const MODEL=option('--model','minimax-code/MiniMax-M3.1-Flash'),ENDPOINT=option('--endpoint','http://127.0.0.1:3425/v1/chat/completions');
mkdirSync(OUT,{recursive:true});

function wrangler(argv){return execFileSync('npx',['wrangler',...argv],{cwd:ROOT,encoding:'utf8',maxBuffer:1<<28,stdio:['ignore','pipe','inherit']});}
function exportLessons(){const out=JSON.parse(wrangler(['d1','execute',DB,'--remote','--json','--command',`SELECT lesson_json FROM lessons WHERE household_id='${HOUSEHOLD}' ORDER BY id`]));return out[0].results.map(r=>JSON.parse(r.lesson_json));}
const only=option('--only')?new RegExp(option('--only')):null;
const lessons=(flag('--export')?exportLessons():JSON.parse(readFileSync(option('--lessons'),'utf8'))).filter(l=>!only||only.test(l.id));

// ---- Model calls with cache --------------------------------------------------------------
const cachePath=OUT+'model-cache.json',cache=existsSync(cachePath)?JSON.parse(readFileSync(cachePath,'utf8')):{};
async function ask(messages){
 const id=createHash('sha256').update(MODEL+JSON.stringify(messages)).digest('hex');
 if(cache[id])return cache[id];
 const res=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(process.env.MAGPIE_KEY||'magpie')},body:JSON.stringify({model:MODEL,max_tokens:4096,reasoning_effort:'low',messages}),signal:AbortSignal.timeout(90000)});
 const j=await res.json();if(!res.ok)throw new Error(`${res.status} ${JSON.stringify(j.error||j).slice(0,200)}`);
 const text=(j.choices?.[0]?.message?.content||'').replace(/<think>[\s\S]*?<\/think>/g,'').trim();
 cache[id]=text;return text;
}

const results={},stats={model:0,rules:0,rejected:{},none:0};
const work=lessons.map(lesson=>{const e=explainLesson(lesson);if(!e){stats.none++;return null;}results[lesson.id]=e;return {lesson,e};}).filter(Boolean);
console.log(`explained ${work.length}/${lessons.length}`);
let next=0,done=0;
async function worker(){
 while(next<work.length){const {lesson,e}=work[next++],source=ruleWhy(e);let why=null,reason='no-model';
  if(source&&!flag('--no-model'))for(let attempt=0;attempt<2&&!why;attempt++){
   try{const messages=prompt(lesson,source);if(attempt)messages[1].content+='\n（上次改写增减了事实，请只换说法。）';const text=await ask(messages);reason=checkWhy(text,source);if(!reason)why=text;}
   catch(err){reason='error '+err.message.slice(0,80);}
  }
  e.why_rules=source;
  if(why){e.why=why;e.why_source='model';stats.model++;}else{e.why=source;e.why_source='rules';stats.rules++;stats.rejected[reason]=(stats.rejected[reason]||0)+1;}
  if(++done%100===0){console.log(`${done}/${work.length}`);writeFileSync(cachePath,JSON.stringify(cache));}
 }
}
await Promise.all(Array.from({length:Number(option('--concurrency',6))},worker));
writeFileSync(cachePath,JSON.stringify(cache));
writeFileSync(OUT+'explanations.json',JSON.stringify(results));
console.log(JSON.stringify(stats));
if(only){for(const[id,e]of Object.entries(results))console.log(id.slice(-14),e.why_source,'\n  R:',e.why_rules,'\n  M:',e.why);process.exit(0);}

// ---- D1 ------------------------------------------------------------------------------------
const q=s=>`'${String(s).replaceAll("'","''")}'`;
const sql=Object.entries(results).map(([id,e])=>`INSERT INTO lesson_explanations(household_id,lesson_id,version,explanation_json) VALUES(${q(HOUSEHOLD)},${q(id)},${EXPLAIN_VERSION},${q(JSON.stringify(e))}) ON CONFLICT(household_id,lesson_id) DO UPDATE SET version=excluded.version,explanation_json=excluded.explanation_json,updated_at=datetime('now');`);
writeFileSync(OUT+'upsert.sql',sql.join('\n')+'\n');
const digest=createHash('sha256').update(Object.keys(results).sort().map(id=>id+'\t'+JSON.stringify(results[id])).join('\n')).digest('hex');
console.log(`wrote ${sql.length} rows to .local/explanations/upsert.sql · local digest ${digest.slice(0,16)}`);
if(flag('--apply')){
 wrangler(['d1','execute',DB,'--remote','--file',OUT+'upsert.sql']);
 const back=JSON.parse(wrangler(['d1','execute',DB,'--remote','--json','--command',`SELECT lesson_id,explanation_json FROM lesson_explanations WHERE household_id='${HOUSEHOLD}' AND version=${EXPLAIN_VERSION} ORDER BY lesson_id`]))[0].results;
 const remote=createHash('sha256').update(back.filter(r=>results[r.lesson_id]).map(r=>r.lesson_id+'\t'+r.explanation_json).join('\n')).digest('hex');
 console.log(`read back ${back.length} rows · remote digest ${remote.slice(0,16)} · ${remote===digest?'match':'MISMATCH'}`);
 if(remote!==digest)process.exitCode=1;
}
