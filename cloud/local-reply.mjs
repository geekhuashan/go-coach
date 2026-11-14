import {group,neighbors,play,key} from './rules.mjs';

// A problem is a local fight: the computer's reply after leaving the answer tree must
// stay next to the stones, not take a big point elsewhere on an empty board.
export const LOCAL_MARGIN = 2;

export function lessonRegion(state, margin = LOCAL_MARGIN) {
  const size = state.size, board = state.board, points = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (board[y][x]) points.push([x, y]);
  if (!points.length) return null;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.max(0, Math.min(...xs) - margin), maxX = Math.min(size - 1, Math.max(...xs) + margin);
  const minY = Math.max(0, Math.min(...ys) - margin), maxY = Math.min(size - 1, Math.max(...ys) + margin);
  if (minX === 0 && minY === 0 && maxX === size - 1 && maxY === size - 1) return null;
  const region = [];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (!board[y][x]) region.push({x, y});
  return region.length ? region : null;
}

export function inRegion(region, move) {
  if (!region) return true;
  if (!move || move.pass) return false;
  return region.some(p => p.x === move.x && p.y === move.y);
}

// Rule-only fallback when an engine ignores the region: capture, escape atari,
// atari, then press on the opponent's weakest adjacent group.
export function localFallbackMove(state, region) {
  const color = state.to_play, seen = [key(state.board), ...(state.history || []).map(h => key(h.board))];
  let best = null;
  for (const p of region || []) {
    let result;
    try { result = play(state.board, p.x, p.y, color, seen); } catch { continue; }
    const after = result.board, own = group(after, p.x, p.y);
    let score = result.captured * 100 + Math.min(own.liberties.length, 4) * 3;
    for (const [a, b] of neighbors(state.board, p.x, p.y)) {
      const c = state.board[b][a];
      if (c === color && group(state.board, a, b).liberties.length === 1) score += 60;
      if (c === 3 - color && after[b][a]) {
        const libs = group(after, a, b).liberties.length;
        score += libs === 1 ? 40 : libs === 2 ? 12 : 4;
      }
      if (c) score += 2;
    }
    const last = state.last_move;
    if (last && Math.abs(last.x - p.x) + Math.abs(last.y - p.y) <= 2) score += 5;
    if (own.liberties.length === 1 && !result.captured) score -= 50;
    if (!best || score > best.score) best = {x: p.x, y: p.y, score};
  }
  return best ? {x: best.x, y: best.y} : {pass: true};
}
