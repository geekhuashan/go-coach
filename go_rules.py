"""Small deterministic Go rules. Positional superko; passes exempt."""
from copy import deepcopy


def neighbors(board, x, y):
    n = len(board)
    return [(a, b) for a, b in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)) if 0 <= a < n and 0 <= b < n]


def group(board, x, y):
    color = board[y][x]
    if not color:
        return set(), set()
    stones, liberties, pending = set(), set(), [(x,y)]
    while pending:
        p = pending.pop()
        if p in stones:
            continue
        stones.add(p)
        for a,b in neighbors(board,*p):
            if board[b][a] == 0:
                liberties.add((a,b))
            elif board[b][a] == color and (a,b) not in stones:
                pending.append((a,b))
    return stones, liberties


def key(board):
    return ''.join(str(c) for row in board for c in row)


def play(board, x, y, color, seen=()):
    if type(x) is not int or type(y) is not int or not (0 <= x < len(board) and 0 <= y < len(board)):
        raise ValueError('落子坐标不在棋盘内。')
    if board[y][x]:
        raise ValueError('这里已经有棋子，请选空交叉点。')
    out = deepcopy(board)
    out[y][x] = color
    removed = set()
    for a,b in neighbors(out,x,y):
        if out[b][a] == 3-color:
            stones, libs = group(out,a,b)
            if not libs:
                removed |= stones
                for c,d in stones:
                    out[d][c] = 0
    stones, libs = group(out,x,y)
    if not libs:
        raise ValueError('这一步会让自己的棋没有气，不能下。')
    if key(out) in seen:
        raise ValueError('不能立即还原已出现的局面（本练习采用全局同形禁着规则）。')
    return out, len(removed)
