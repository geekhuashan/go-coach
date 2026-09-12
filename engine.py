"""Local KataGo analysis adapter. No cloud calls; one persistent engine process."""
import atexit
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent
_lock = threading.Lock()
_process = None
_output = queue.Queue()
_status = "尚未启动"
_last_error = ""
COLS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"


def _paths():
    binary = os.environ.get("GO_COACH_KATAGO") or shutil.which("katago")
    if not binary and Path("/opt/homebrew/bin/katago").exists():
        binary = "/opt/homebrew/bin/katago"
    model = os.environ.get("GO_COACH_MODEL")
    if not model:
        candidates = sorted(Path("/opt/homebrew/share/katago").glob("*b18*.bin.gz"))
        candidates += sorted((ROOT / ".local/models").glob("*.bin.gz"))
        model = str(candidates[0]) if candidates else None
    return binary, model


def info():
    binary, model = _paths()
    return {"available": bool(binary and model and Path(model).is_file()),
            "name": "KataGo · 本地陪练", "status": _status,
            "note": "棋力较强，可暂停、悔棋；不是校准的入门段位。", "error": _last_error,
            "busy": _lock.locked()}


def close():
    global _process
    if _process is not None:
        _process.terminate()
        try:
            _process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            _process.kill()
        _process = None


atexit.register(close)


def _start():
    global _process, _output, _status
    if _process is not None and _process.poll() is None:
        return
    binary, model = _paths()
    if not binary or not model:
        raise RuntimeError("本地 KataGo 或模型尚未安装，仍可练题和双人摆棋。")
    (ROOT / ".local").mkdir(exist_ok=True)
    _output = queue.Queue()
    _status = "首次加载中"
    log = open(ROOT / ".local/engine.log", "a", encoding="utf-8")
    _process = subprocess.Popen([binary, "analysis", "-config", str(ROOT / "analysis.cfg"),
                                 "-model", model], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=log, text=True, bufsize=1, cwd=ROOT)
    log.close()
    process, output = _process, _output

    def reader():
        for line in process.stdout:
            try:
                output.put(json.loads(line))
            except json.JSONDecodeError:
                continue
        output.put({"_exit": True})

    threading.Thread(target=reader, daemon=True).start()


def _check_size(size):
    if type(size) is not int or not 2 <= size <= len(COLS):
        raise ValueError("棋盘大小超出坐标支持范围。")


def coordinate(x, y, size):
    _check_size(size)
    if type(x) is not int or type(y) is not int or not 0 <= x < size or not 0 <= y < size:
        raise ValueError("落子坐标超出当前棋盘。")
    return COLS[x] + str(size - y)


def parse_move(value, size):
    _check_size(size)
    if not isinstance(value, str):
        raise RuntimeError("引擎返回了无效坐标。")
    value = value.strip().upper()
    if value == 'PASS':
        return {'pass': True}
    if len(value) < 2 or value[0] not in COLS or not value[1:].isascii() or not value[1:].isdigit():
        raise RuntimeError("引擎返回了无效坐标。")
    x, y = COLS.index(value[0]), size - int(value[1:])
    if not 0 <= x < size or not 0 <= y < size:
        raise RuntimeError("引擎返回的落点超出当前棋盘。")
    return {'x': x, 'y': y}


def analysis_query(state, request_id):
    """Encode both supported board sizes without a fixed coordinate origin."""
    size = state['size']
    _check_size(size)
    initial = state.get('initial_board', state['board'])
    if len(initial) != size or any(len(row) != size for row in initial):
        raise ValueError("初始局面尺寸与当前棋盘不一致。")
    moves = state.get('moves', []) if 'initial_board' in state else []
    return {
        'id': request_id, 'boardXSize': size, 'boardYSize': size,
        'initialStones': [['B' if c == 1 else 'W', coordinate(x, y, size)]
                          for y, row in enumerate(initial) for x, c in enumerate(row) if c],
        'initialPlayer': 'B' if state.get('initial_player', state['to_play']) == 1 else 'W',
        'moves': [['B' if m['color'] == 1 else 'W',
                   'pass' if m.get('pass') else coordinate(m['x'], m['y'], size)] for m in moves],
        'rules': {'ko': 'POSITIONAL', 'scoring': 'AREA', 'tax': 'NONE',
                  'suicide': False, 'hasButton': False, 'whiteHandicapBonus': '0'},
        'komi': 7.5, 'maxVisits': 64, 'includeOwnership': False,
    }


def _run_query(query, timeout=90):
    """Send one bounded request while the caller holds the process lock."""
    global _status, _last_error
    deadline = time.monotonic() + timeout
    _start()
    try:
        _process.stdin.write(json.dumps(query) + "\n")
        _process.stdin.flush()
        while time.monotonic() < deadline:
            result = _output.get(timeout=max(0.1, deadline - time.monotonic()))
            if result.get("_exit"):
                raise RuntimeError("KataGo 进程退出，请检查本地 engine.log。")
            if result.get("id") != query['id']:
                continue
            if "error" in result:
                raise RuntimeError(result["error"])
            if result.get("isDuringSearch"):
                continue
            if "moveInfos" not in result:
                continue
            _status, _last_error = "已就绪", ""
            return result
        raise RuntimeError("KataGo 分析超时，可继续练题，稍后再试。")
    except (OSError, queue.Empty, RuntimeError) as exc:
        _status, _last_error = "暂不可用", str(exc) or "分析超时"
        close()
        raise RuntimeError(_last_error) from exc


def analyze(state):
    if not _lock.acquire(timeout=2):
        raise RuntimeError("当前 KataGo 正在计算另一手，请稍后重试。")
    try:
        query = analysis_query(state, uuid.uuid4().hex)
        result = _run_query(query, timeout=8)
        return {"revision":state["revision"], "engine":"KataGo", "perspective":"black",
                "rootInfo":result.get("rootInfo",{}), "moves":result["moveInfos"][:8]}
    finally:
        _lock.release()


def review_points(state):
    """Accept exactly two named board coordinates, never client query options."""
    value = state.get('review')
    if not isinstance(value, dict) or set(value) != {'candidate', 'reference'}:
        raise ValueError('复核需要候选和参考两个落点。')
    if type(state.get('to_play')) is not int or state['to_play'] not in (1,2):
        raise ValueError('复核先行方无效。')
    points = {}
    for label in ('candidate', 'reference'):
        point = value[label]
        if not isinstance(point, dict) or set(point) != {'x','y'}:
            raise ValueError('复核落点只允许 x、y 坐标。')
        points[label] = coordinate(point['x'], point['y'], state['size'])
        if state['board'][point['y']][point['x']] != 0:
            raise ValueError('复核落点必须为空点。')
    return points


def review(state):
    """Compare two root constraints; return evidence without a life/death verdict."""
    points = review_points(state)
    queries = {}
    for label, point in points.items():
        query = analysis_query(state, uuid.uuid4().hex)
        query.update(maxVisits=128, includeOwnership=True,
                     allowMoves=[{'player':'B' if state['to_play']==1 else 'W',
                                  'moves':[point], 'untilDepth':1}],
                     overrideSettings={'maxTime':3,'reportAnalysisWinratesAs':'BLACK'})
        queries[label] = query
    deadline = time.monotonic() + 12
    if not _lock.acquire(timeout=2):
        raise RuntimeError('KataGo 正忙，请稍后再复核。')
    try:
        result = {'revision':state['revision'],'engine':'KataGo','perspective':'black'}
        for label, query in queries.items():
            remaining = deadline - time.monotonic()
            if remaining <= 0: raise RuntimeError('KataGo 复核超时，请稍后重试。')
            raw = _run_query(query, timeout=min(6, remaining))
            moves, ownership = raw.get('moveInfos'), raw.get('ownership')
            if not isinstance(raw.get('rootInfo'), dict) or not isinstance(moves,list) or not moves:
                raise RuntimeError('KataGo 未返回完整复核信息。')
            if any(not isinstance(m,dict) or m.get('move')!=points[label] for m in moves):
                raise RuntimeError('KataGo 未返回指定根落点的复核信息。')
            if not isinstance(ownership,list) or len(ownership)!=state['size']**2:
                raise RuntimeError('KataGo 未返回完整归属预测。')
            result[label] = {'move':points[label], 'rootInfo':raw['rootInfo'],
                             'moves':moves[:8], 'ownership':ownership}
        return result
    finally:
        _lock.release()


def choose_move(state):
    result = analyze(state)
    if not result["moves"]:
        raise RuntimeError("引擎没有返回合法候选点。")
    best = min(result["moves"], key=lambda m:m.get("order",999))
    return parse_move(best["move"], state["size"])
