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
            "note": "棋力较强，可暂停、悔棋；不是校准的入门段位。", "error": _last_error}


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


def analyze(state):
    global _status, _last_error
    with _lock:
        request_id = uuid.uuid4().hex
        query = analysis_query(state, request_id)
        _start()
        try:
            _process.stdin.write(json.dumps(query) + "\n")
            _process.stdin.flush()
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                result = _output.get(timeout=max(0.1, deadline - time.monotonic()))
                if result.get("_exit"):
                    raise RuntimeError("KataGo 进程退出，请检查本地 engine.log。")
                if result.get("id") != request_id:
                    continue
                if "error" in result:
                    raise RuntimeError(result["error"])
                if result.get("isDuringSearch"):
                    continue
                if "moveInfos" not in result:
                    continue
                _status, _last_error = "已就绪", ""
                return {"revision":state["revision"], "engine":"KataGo", "perspective":"black",
                        "rootInfo":result.get("rootInfo",{}), "moves":result["moveInfos"][:8]}
            raise RuntimeError("KataGo 分析超时，可继续练题，稍后再试。")
        except (OSError, queue.Empty, RuntimeError) as exc:
            _status, _last_error = "暂不可用", str(exc) or "分析超时"
            close()
            raise RuntimeError(_last_error) from exc


def choose_move(state):
    result = analyze(state)
    if not result["moves"]:
        raise RuntimeError("引擎没有返回合法候选点。")
    best = min(result["moves"], key=lambda m:m.get("order",999))
    return parse_move(best["move"], state["size"])
