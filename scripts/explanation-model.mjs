// Rewording rules for scripts/build_explanations.mjs. The reason is composed from rule facts
// first; the model may only make that text easier for a child to read, never add to it.
const NUM=/\d+/g,LABEL=/[黑白]\d+/g;
const TERMS=['提掉','打吃','真眼','假眼','活棋','死棋','做活','活了','逃不掉','送给','连成','分成','罩住','斜角','破眼','眼','征','劫','双活','倒扑','接不归','枷','扑','对杀','紧气','长气','气'];
const KEEP=['提掉','逃不掉','真眼','假眼','活','死'];
const TRADITIONAL=/[氣們這個說為對時從裡會麼讓過還邊兩來斷連圍與點將]/;

// Board-mark references only make sense next to the marked board, so the reason drops them.
const unmark=text=>text.replace(/（标“[^”]+”）/g,'').replace(/标“[^”]+”那只眼/g,'这只眼').replace(/标“[^”]+”的(地方|点)/g,(m,w)=>w==='点'?'这个点':'那里');
export function ruleWhy(e){
 if(e.answer){const shape=e.steps[0]?.text||'';return shape+e.summary.filter(s=>!shape.includes(s)).map(s=>s+'。').join('');}
 // A move with nothing to report ("黑1。") says nothing on its own.
 const solver=e.steps.filter(s=>s.move?.color===1&&s.text.includes('：')),parts=[];
 if(solver[0])parts.push(solver[0].text);
 // A summary that starts by repeating the move's own clause only adds its new ending.
 for(const line of e.summary){const clauses=line.split('，'),said=parts.join('');let k=0;while(k<clauses.length&&said.includes(clauses[k]))k++;
  if(k===clauses.length)continue;if(k&&parts.length)parts[parts.length-1]=parts.at(-1).replace(/。$/,'，'+clauses.slice(k).join('，')+'。');else parts.push(line+'。');}
 if(!e.summary.length&&solver.length>1)parts.push(solver.at(-1).text);
 return unmark(parts.join(''));
}
export function prompt(lesson,source){
 return [{role:'system',content:'你是耐心的围棋老师。把给定的一段讲解改写得更口语、更适合刚学棋的小朋友听。不能增加、删除或改变任何事实；原文没有的数字、棋子编号、围棋术语一律不能出现。'},
  {role:'user',content:`章节：${lesson.concept||''}\n原文：${source}\n\n要求：1到3句，不超过${limit(source)}个字；原文里的棋子编号（如“黑1”）都要保留；数字用阿拉伯数字；用简体字；只输出改写后的话。`}];
}
const limit=source=>Math.max(60,source.length+10);
const segments=text=>{const out=new Map();for(const sentence of text.split(/[。！？；]/))for(const part of sentence.split(/(?=[黑白]\d+)/)){const l=part.match(/^[黑白]\d+/)?.[0];if(l)out.set(l,(out.get(l)||'')+part);}return out;};
// The rewrite may use only the source's numbers, labels and terms, must keep every move label
// and the conclusion words, and may not move a capture or atari onto another stone.
export function checkWhy(text,source){
 if(!text||text.length<8||text.length>limit(source)||/[A-Za-z\n]/.test(text))return 'length';
 if(TRADITIONAL.test(text))return 'traditional';
 for(const m of text.match(/[一二两三四五六七八九十]+(口气|子|只|手|格|个|处)/g)||[])if(!source.includes(m))return 'numeral';
 const nums=new Set(source.match(NUM)||[]);for(const n of text.match(NUM)||[])if(!nums.has(n))return 'number';
 const want=new Set(source.match(LABEL)||[]),got=new Set(text.match(LABEL)||[]);
 if(want.size!==got.size||[...want].some(l=>!got.has(l)))return 'labels';
 let rest=text;for(const t of TERMS){if(rest.includes(t)&&!source.includes(t))return 'term';rest=rest.replaceAll(t,'');}
 for(const t of KEEP)if(source.includes(t)&&!text.includes(t))return 'dropped';
 const from=segments(source);
 for(const[l,part]of segments(text))for(const v of ['提掉','打吃'])if(part.includes(v)&&!(from.get(l)||'').includes(v)&&!/会被|就会|都会/.test(part))return 'moved';
 return null;
}
