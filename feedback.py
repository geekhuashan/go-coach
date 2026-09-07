"""Immediate, deterministic feedback for free play; never assigns a rank."""
from go_rules import group, neighbors

COLS = "ABCDEFGHJKLMNOPQRST"


def free_feedback(before, after, move, color, captured):
    x, y = move["x"], move["y"]
    stones, liberties = group(after, x, y)
    adjacent_groups = {}
    for a, b in neighbors(before, x, y):
        if before[b][a] == color:
            old_stones, old_liberties = group(before, a, b)
            adjacent_groups[frozenset(old_stones)] = old_liberties
    rescued = any(len(v) == 1 for v in adjacent_groups.values()) and len(liberties) > 1
    name = "黑棋" if color == 1 else "白棋"
    points = "、".join(COLS[a] + str(len(after) - b) for a, b in sorted(liberties))
    facts = [f"{name}落在 {COLS[x]}{len(after)-y}，这块棋现在有 {len(stones)} 颗棋子、{len(liberties)} 口气。"]
    if captured:
        facts.append(f"对方有 {captured} 颗棋子失去全部的气，已被提走。")
    if len(adjacent_groups) > 1:
        facts.append(f"原来的 {len(adjacent_groups)} 块同色棋直接连在了一起，按整块数气，共同的空点只数一次。")
    if rescued:
        facts.append("原本只剩一口气的棋块，现在有了更多气，解除了这次打吃。")
    if points:
        facts.append(f"气在 {points}。")
    if len(liberties) == 1:
        summary = "留意：这块棋只剩一口气"
        facts.append("看看对方能否合法占住最后一口气，把它提走。先考虑这块棋，再考虑别处。")
    elif captured:
        summary = f"这一步提走了 {captured} 颗棋子"
        facts.append("提子以后也要重新数自己的气；提到棋子不等于整局已经占优。")
    elif rescued:
        summary = "这一步解除了打吃"
        facts.append("有两口以上的气表示现在没被打吃，不代表以后一定不会被吃。")
    elif len(adjacent_groups) > 1:
        summary = "这一步把同色棋连成了一块"
        facts.append("观察连好后留下的空点，判断对方还能从哪里紧气。")
    else:
        summary = f"这块棋现在有 {len(liberties)} 口气"
        facts.append("下一手先观察：对方有没有只剩一口气的棋？自己的棋有没有需要照顾的地方？")
    return {
        "correct": None, "summary": summary, "explanation": "\n".join(facts),
        "marks": [{"x": a, "y": b, "label": "气"} for a, b in sorted(liberties)],
        "source": "rules", "counted_for_learning": False,
    }
