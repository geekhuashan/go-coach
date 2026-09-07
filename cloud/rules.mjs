export const clone = value => structuredClone(value);
export const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
export function key(board) { return board.flat().join(''); }
export function neighbors(board, x, y) { return [[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([a,b])=>a>=0&&b>=0&&a<board.length&&b<board.length); }
export function group(board, x, y) {
  const color=board[y]?.[x]; if(!color)return {stones:[],liberties:[]};
  const stones=new Map(),liberties=new Map(),pending=[[x,y]];
  while(pending.length){const p=pending.pop(),id=p.join(',');if(stones.has(id))continue;stones.set(id,p);
    for(const q of neighbors(board,...p)){const c=board[q[1]][q[0]];if(!c)liberties.set(q.join(','),q);else if(c===color&&!stones.has(q.join(',')))pending.push(q);}}
  return {stones:[...stones.values()],liberties:[...liberties.values()]};
}
export function play(board,x,y,color,seen=[]){
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=board.length||y>=board.length)throw new Error('落子坐标不在棋盘内。');
  if(color!==1&&color!==2)throw new Error('执棋颜色无效。');
  if(board[y][x])throw new Error('这里已经有棋子，请选空交叉点。');
  const out=clone(board);out[y][x]=color;let captured=0;
  for(const [a,b]of neighbors(out,x,y)){if(out[b][a]===3-color){const g=group(out,a,b);if(!g.liberties.length){captured+=g.stones.length;for(const[c,d]of g.stones)out[d][c]=0;}}}
  if(!group(out,x,y).liberties.length)throw new Error('这一步会让自己的棋没有气，不能下。');
  if(seen.includes(key(out)))throw new Error('不能还原已出现的局面（全局同形禁着）。');
  return {board:out,captured};
}
export function coord(x,y,size=9){return COLS[x]+String(size-y);}
export function boardFor(lesson){const board=Array.from({length:lesson.size||9},()=>Array(lesson.size||9).fill(0));for(const p of lesson.stones)board[p.y][p.x]=p.color;return board;}
