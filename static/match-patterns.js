/* Read-only historical board; never changes the active match or practice scores. */
(function(){
 'use strict';
 let dialog=null,returnFocus=null;
 const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
 function close(){if(!dialog)return;dialog.remove();dialog=null;if(returnFocus&&document.contains(returnFocus))returnFocus.focus();}
 function open(data,{onPractice,onReturn}={}){
  close();returnFocus=document.activeElement;
  dialog=el('div',undefined,'pattern-review-overlay');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','pattern-review-title');
  const style=el('style',`.pattern-review-overlay{position:fixed;inset:0;z-index:1000;background:rgba(22,35,28,.55);display:flex;align-items:center;justify-content:center;padding:12px}.pattern-review-panel{box-sizing:border-box;background:#faf8f1;color:#213b30;width:min(900px,100%);max-height:94vh;overflow:auto;border-radius:16px;padding:18px;box-shadow:0 12px 60px #0003}.pattern-review-panel h2{margin:0;font-size:22px}.pattern-review-panel p{line-height:1.6}.pattern-review-head,.pattern-review-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between}.pattern-review-panel button,.pattern-review-panel select{min-height:44px;padding:8px 12px;border:1px solid #aab8ab;border-radius:8px;background:#fff;color:#213b30;font:inherit}.pattern-review-panel button{cursor:pointer}.pattern-review-panel button:disabled{opacity:.5}.pattern-review-panel button.primary{background:#285a45;color:white}.pattern-review-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(240px,1fr);gap:20px;margin-top:14px}.pattern-review-board{width:100%;max-height:66vh;background:#dfb676;border-radius:10px;touch-action:manipulation}.pattern-review-status{min-height:24px}.pattern-review-note{font-size:13px;color:#546258}@media(max-width:650px){.pattern-review-grid{display:block}.pattern-review-board{max-height:48vh}}`);
  const panel=el('section',undefined,'pattern-review-panel'),head=el('div',undefined,'pattern-review-head'),title=el('h2','实战棋型回看');title.id='pattern-review-title';const dismiss=el('button','关闭');dismiss.onclick=close;head.append(title,dismiss);panel.append(head,el('p',data.note,'pattern-review-note'));dialog.append(style,panel);document.body.append(dialog);
  dialog.addEventListener('click',e=>{if(e.target===dialog)close();});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}if(e.key==='Tab'){const nodes=[...dialog.querySelectorAll('button:not(:disabled),select,[tabindex="0"]')],first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}});
  if(!data.items?.length){panel.append(el('p','这段棋谱暂时没有检测到可回看的基础棋型。随着继续下棋，这里会补充真实局面。'));dismiss.focus();return;}
  const choose=el('select');choose.setAttribute('aria-label','选择历史棋型');data.items.forEach((item,i)=>{const option=el('option',`第 ${item.move_number} 手 · ${item.title}`);option.value=String(i);choose.append(option);});panel.append(choose);
  const grid=el('div',undefined,'pattern-review-grid');panel.append(grid);
  function render(){
   const item=data.items[Number(choose.value)],size=item.before_board.length;let revealed=false,pick=null;
   grid.replaceChildren();const board=document.createElementNS('http://www.w3.org/2000/svg','svg');board.classList.add('pattern-review-board');board.setAttribute('viewBox',`0 0 ${size+1} ${size+1}`);board.setAttribute('role','img');board.setAttribute('aria-label',`第 ${item.move_number} 手前的 ${size} 路棋盘`);
   const aside=el('div'),prompt=el('p',item.prompt),status=el('p','先在棋盘上点出你现在想到的一手，再看当时的选择。','pattern-review-status');status.setAttribute('aria-live','polite');const reveal=el('button','看看当时有没有看出来','primary'),actions=el('div',undefined,'pattern-review-actions');actions.append(reveal);aside.append(prompt,status,actions);grid.append(board,aside);
   function svg(tag,attrs){const n=document.createElementNS(board.namespaceURI,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));board.append(n);return n;}
   function draw(){board.replaceChildren();for(let i=0;i<size;i++){svg('line',{x1:1,y1:i+1,x2:size,y2:i+1,stroke:'#74582f','stroke-width':.025});svg('line',{x1:i+1,y1:1,x2:i+1,y2:size,stroke:'#74582f','stroke-width':.025});}
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(item.before_board[y][x])svg('circle',{cx:x+1,cy:y+1,r:.43,fill:item.before_board[y][x]===1?'#20221f':'#fafaf4',stroke:item.before_board[y][x]===1?'#111':'#9c9c90','stroke-width':.03});
    if(revealed)for(const p of item.candidates){svg('circle',{cx:p.x+1,cy:p.y+1,r:.3,fill:'none',stroke:'#146b9b','stroke-width':.08});}
    if(revealed&&!item.actual_move.pass){const p=item.actual_move;svg('rect',{x:p.x+.68,y:p.y+.68,width:.64,height:.64,fill:'none',stroke:'#b04929','stroke-width':.08});}
    if(pick)svg('circle',{cx:pick.x+1,cy:pick.y+1,r:.14,fill:'#18543c',stroke:'white','stroke-width':.04});
   }
   board.addEventListener('click',e=>{if(revealed)return;const rect=board.getBoundingClientRect();const rendered=Math.min(rect.width,rect.height),offsetX=(rect.width-rendered)/2,offsetY=(rect.height-rendered)/2,x=Math.round((e.clientX-rect.left-offsetX)/rendered*(size+1)-1),y=Math.round((e.clientY-rect.top-offsetY)/rendered*(size+1)-1);if(x<0||y<0||x>=size||y>=size||item.before_board[y][x])return;pick={x,y};status.textContent='已记住你现在的选择，点下面按钮核对。';draw();});
   reveal.onclick=()=>{revealed=true;draw();status.textContent=(pick?(item.candidates.some(p=>p.x===pick.x&&p.y===pick.y)?'这次你找到了这种棋型。':'这次选的点没有触发这里展示的基本棋型。'):'')+item.explanation;reveal.remove();aside.append(el('p','蓝圈：这种棋型的可行点；红框：当时实际落点；绿点：这次选择。','pattern-review-note'));
    if(item.lesson&&onPractice){const practice=el('button','回基础题练一练','primary');practice.onclick=()=>{close();onPractice(item.lesson.id,data.match_id);};actions.append(practice);aside.append(el('p',`相关基础：${item.lesson.title}`,'pattern-review-note'));}
   };
   if(onReturn&&data.match_id){const back=el('button','回到这盘实战');back.onclick=()=>{close();onReturn(data.match_id);};actions.append(back);}
   draw();
  }
  choose.onchange=render;render();dismiss.focus();
 }
 window.GoMatchPatterns={open,close};
})();
