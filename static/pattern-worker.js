(() => {
  // cloud/rules.mjs
  var clone = (value) => structuredClone(value);
  var COLS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";
  function key(board) {
    return board.flat().join("");
  }
  function neighbors(board, x, y) {
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < board.length && b < board.length);
  }
  function group(board, x, y) {
    const color = board[y]?.[x];
    if (!color) return { stones: [], liberties: [] };
    const stones = /* @__PURE__ */ new Map(), liberties = /* @__PURE__ */ new Map(), pending = [[x, y]];
    while (pending.length) {
      const p = pending.pop(), id = p.join(",");
      if (stones.has(id)) continue;
      stones.set(id, p);
      for (const q of neighbors(board, ...p)) {
        const c = board[q[1]][q[0]];
        if (!c) liberties.set(q.join(","), q);
        else if (c === color && !stones.has(q.join(","))) pending.push(q);
      }
    }
    return { stones: [...stones.values()], liberties: [...liberties.values()] };
  }
  function play(board, x, y, color, seen = []) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= board.length || y >= board.length) throw new Error("\u843D\u5B50\u5750\u6807\u4E0D\u5728\u68CB\u76D8\u5185\u3002");
    if (color !== 1 && color !== 2) throw new Error("\u6267\u68CB\u989C\u8272\u65E0\u6548\u3002");
    if (board[y][x]) throw new Error("\u8FD9\u91CC\u5DF2\u7ECF\u6709\u68CB\u5B50\uFF0C\u8BF7\u9009\u7A7A\u4EA4\u53C9\u70B9\u3002");
    const out = clone(board);
    out[y][x] = color;
    let captured = 0;
    for (const [a, b] of neighbors(out, x, y)) {
      if (out[b][a] === 3 - color) {
        const g = group(out, a, b);
        if (!g.liberties.length) {
          captured += g.stones.length;
          for (const [c, d] of g.stones) out[d][c] = 0;
        }
      }
    }
    if (!group(out, x, y).liberties.length) throw new Error("\u8FD9\u4E00\u6B65\u4F1A\u8BA9\u81EA\u5DF1\u7684\u68CB\u6CA1\u6709\u6C14\uFF0C\u4E0D\u80FD\u4E0B\u3002");
    if (seen.includes(key(out))) throw new Error("\u4E0D\u80FD\u8FD8\u539F\u5DF2\u51FA\u73B0\u7684\u5C40\u9762\uFF08\u5168\u5C40\u540C\u5F62\u7981\u7740\uFF09\u3002");
    return { board: out, captured };
  }
  function coord(x, y, size = 9) {
    return COLS[x] + String(size - y);
  }

  // cloud/match-patterns.mjs
  var TYPES = { capture: { title: "\u63D0\u5B50", skill: "capture" }, escape: { title: "\u9003\u51FA\u6253\u5403", skill: "escape" }, double_atari: { title: "\u53CC\u6253\u5403", skill: "capture" }, atari: { title: "\u6253\u5403", skill: "capture" } };
  function groups(board) {
    const seen = /* @__PURE__ */ new Set(), out = [];
    for (let y = 0; y < board.length; y++) for (let x = 0; x < board.length; x++) {
      if (!board[y][x] || seen.has(`${x},${y}`)) continue;
      const g = group(board, x, y);
      for (const p of g.stones) seen.add(p.join(","));
      out.push({ ...g, color: board[y][x] });
    }
    return out;
  }
  var point = ([x, y]) => ({ x, y });
  var same = (a, b) => !a?.pass && a?.x === b.x && a?.y === b.y;
  function opportunities(board, color, seen) {
    const all = groups(board), points = /* @__PURE__ */ new Map();
    for (const g of all) if (g.liberties.length <= (g.color === color ? 1 : 2)) for (const p of g.liberties) points.set(p.join(","), p);
    const found = { capture: [], escape: [], double_atari: [], atari: [] };
    for (const [x, y] of points.values()) {
      let next;
      try {
        next = play(board, x, y, color, seen);
      } catch {
        continue;
      }
      const endangered = all.filter((g) => g.color === color && g.liberties.length === 1), saved = endangered.filter((g) => g.stones.every(([a, b]) => next.board[b][a] === color) && group(next.board, ...g.stones[0]).liberties.length >= 2);
      const threatened = all.filter((g) => g.color !== color && g.liberties.length === 2 && g.stones.every(([a, b]) => next.board[b][a] === 3 - color) && group(next.board, ...g.stones[0]).liberties.length === 1);
      const captured = all.filter((g) => g.color !== color && g.stones.some(([a, b]) => next.board[b][a] === 0));
      const add = (kind, targets) => found[kind].push({ x, y, targets: targets.flatMap((g) => g.stones.map(point)), captured: next.captured });
      if (captured.length) add("capture", captured);
      if (saved.length) add("escape", saved);
      if (threatened.length >= 2) add("double_atari", threatened);
      else if (threatened.length) add("atari", threatened);
    }
    return found;
  }
  function analyzeMatchPatterns(state, { catalog = [], profileId, limit = 24, maxMoves = 120 } = {}) {
    const out = { match_id: state?.match?.id || state?.match_id || null, source: "rules", note: "\u53EA\u6838\u5BF9\u63D0\u5B50\u3001\u6C14\u6570\u4E0E\u6253\u5403\u7B49\u5C40\u90E8\u4E8B\u5B9E\uFF1B\u6CA1\u6709\u4E0B\u8FD9\u4E9B\u70B9\uFF0C\u4E0D\u7B49\u4E8E\u6F0F\u62DB\u6216\u574F\u68CB\u3002\u8FD9\u91CC\u4E0D\u6539\u7EC3\u4E60\u6210\u7EE9\u3002", reviewed_moves: 0, total_moves: state?.moves?.length || 0, items: [] };
    if (state?.mode !== "free" || !state.match) return { ...out, note: "\u8BF7\u5148\u9009\u62E9\u4E00\u76D8\u5B9E\u6218\u5BF9\u5C40\u3002" };
    const size = state.size, initial = state.initial_board;
    if (![9, 19].includes(size) || !Array.isArray(initial) || initial.length !== size || initial.some((r) => !Array.isArray(r) || r.length !== size || r.some((c) => ![0, 1, 2].includes(c))) || !Array.isArray(state.moves) || state.moves.length > 1e3) return { ...out, incomplete: true, note: "\u68CB\u8C31\u683C\u5F0F\u4E0D\u5B8C\u6574\uFF0C\u6682\u65F6\u4E0D\u80FD\u56DE\u770B\u68CB\u578B\u3002" };
    const colors = profileId ? [1, 2].filter((c) => state.match[c === 1 ? "black" : "white"]?.profile_id === profileId) : [1, 2];
    if (!colors.length) return { ...out, note: "\u5F53\u524D\u5B66\u4E60\u8005\u6CA1\u6709\u53C2\u52A0\u8FD9\u76D8\u68CB\u3002" };
    let board = clone(initial), toPlay = state.initial_player || 1;
    const seen = [key(board)];
    const start = Math.max(0, state.moves.length - Math.max(1, Math.min(200, maxMoves))), found = [];
    for (let index = 0; index < state.moves.length; index++) {
      const move = state.moves[index];
      let next;
      try {
        if (!move || move.color !== toPlay) throw Error("turn");
        next = move.pass ? { board } : play(board, move.x, move.y, move.color, seen);
      } catch {
        return { ...out, items: [], incomplete: true, note: `\u68CB\u8C31\u7B2C ${index + 1} \u624B\u65E0\u6CD5\u6309\u89C4\u5219\u91CD\u653E\uFF0C\u6682\u4E0D\u5C55\u793A\u53EF\u80FD\u4E0D\u51C6\u786E\u7684\u68CB\u578B\u3002` };
      }
      if (index >= start && colors.includes(move.color)) {
        out.reviewed_moves++;
        const options = opportunities(board, move.color, seen);
        const kind = Object.keys(TYPES).find((k) => options[k].some((p) => same(move, p))) || Object.keys(TYPES).find((k) => options[k].length);
        if (kind) {
          const candidates = options[kind], actual = candidates.find((p) => same(move, p)), fact = actual || candidates[0], type = TYPES[kind];
          const easiest = (a, b) => (a.difficulty || 1) - (b.difficulty || 1) || a.id.localeCompare(b.id);
          const lesson = catalog.filter((l) => l.concept === kind).sort(easiest)[0] || catalog.filter((l) => l.skill === type.skill && !l.sequence && l.difficulty === 1).sort(easiest)[0] || catalog.filter((l) => l.skill === type.skill).sort(easiest)[0];
          const status = actual ? "played" : "available", description = { capture: "\u63D0\u8D70\u5BF9\u65B9\u68CB\u5B50", escape: "\u8BA9\u88AB\u6253\u5403\u7684\u5DF1\u65B9\u68CB\u5757\u91CD\u65B0\u6709\u81F3\u5C11\u4E24\u53E3\u6C14", double_atari: "\u8BA9\u5BF9\u65B9\u4E24\u5757\u539F\u672C\u6709\u4E24\u53E3\u6C14\u7684\u68CB\u540C\u65F6\u53EA\u5269\u4E00\u53E3\u6C14", atari: "\u8BA9\u5BF9\u65B9\u539F\u672C\u6709\u4E24\u53E3\u6C14\u7684\u4E00\u5757\u68CB\u53EA\u5269\u4E00\u53E3\u6C14" }[kind];
          found.push({ id: `${out.match_id}:${index + 1}:${kind}`, move_number: index + 1, color: move.color, kind, status, title: type.title, prompt: `\u56DE\u5230\u7B2C ${index + 1} \u624B\u843D\u5B50\u524D\u3002\u8F6E\u5230${move.color === 1 ? "\u9ED1" : "\u767D"}\u68CB\uFF0C\u4F60\u80FD\u627E\u5230${type.title}\u7684\u70B9\u5417\uFF1F`, explanation: actual ? `\u4F60\u5F53\u65F6\u8D70\u5728 ${coord(move.x, move.y, size)}\uFF0C\u8FD9\u624B\u786E\u5B9E${description}\u3002` : `\u5F53\u65F6 ${coord(fact.x, fact.y, size)} \u53EF\u4EE5${description}\u3002\u4F60\u8D70\u4E86${move.pass ? "\u505C\u4E00\u624B" : coord(move.x, move.y, size)}\uFF1B\u662F\u5426\u503C\u5F97\u8FD9\u6837\u4E0B\uFF0C\u8FD8\u8981\u7ED3\u5408\u5168\u5C40\u5224\u65AD\u3002`, before_board: clone(board), actual_move: clone(move), candidates: candidates.map((p) => ({ x: p.x, y: p.y })), targets: fact.targets, lesson: lesson ? { id: lesson.id, title: lesson.title, skill: lesson.skill } : null });
        }
      }
      board = next.board;
      toPlay = 3 - toPlay;
      if (!move.pass) seen.push(key(board));
    }
    out.items = found.slice(-Math.max(1, Math.min(50, limit))).reverse();
    out.scanned_from_move = start + 1;
    if (start) out.note += ` \u672C\u6B21\u68C0\u67E5\u6700\u8FD1 ${state.moves.length - start} \u624B\u3002`;
    return out;
  }

  // cloud/match-patterns-worker.mjs
  self.onmessage = (event) => {
    try {
      const { state, catalog = [], profileId } = event.data || {};
      self.postMessage(analyzeMatchPatterns(state, { catalog, profileId }));
    } catch {
      self.postMessage({ error: "\u8FD9\u76D8\u68CB\u6682\u65F6\u65E0\u6CD5\u751F\u6210\u68CB\u578B\u56DE\u770B\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" });
    }
  };
})();
