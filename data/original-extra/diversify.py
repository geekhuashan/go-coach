#!/usr/bin/env python3
"""Build two distinct short reading exercises; never pad counts with remote stones."""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import tactics
from go_rules import play, key


def build():
    chase = tactics._lesson('original-diverse-edge-turn', '一线追吃：先逼退，再补内侧的气', 4,
        [(3, 1), (1, 1)], [(3, 0)], [(3, 0)], [[
            ((4, 0), '先从右侧打吃，把白棋赶向左侧已有黑子的方向。'),
            ((2, 0), '白棋沿一线退一格，此时有左侧和内侧两口气。'),
            ((2, 1), '先补住内侧的气，再把白棋往左赶；不能一直沿一线照着追。'),
            ((1, 0), '白棋再向左退，下面已有黑子，只剩角上一口气。'),
            ((0, 0), '填掉最后一口气，提掉一线上的三颗白棋。')]],
        '白棋长出后重新数气，留意第二手要从内侧紧气。')
    chase['concept'] = 'edge_chase'
    # A central two-point cavity, with no reliance on a board edge. Every
    # surrounding stone directly supplies a liberty constraint in the reading.
    white = [(2, 2), (3, 2), (4, 2), (5, 2), (2, 3), (5, 3), (2, 4), (3, 4), (4, 4), (5, 4)]
    cavity = {(3, 3), (4, 3)}
    border = {(x+dx, y+dy) for x, y in white for dx, dy in [(0, 1), (1, 0), (0, -1), (-1, 0)]} - set(white) - cavity
    snapback = tactics._lesson('original-diverse-snapback-center', '倒扑：中央两点空位里回提', 4,
        sorted(border), white, white, [[
            ((3, 3), '从两点空位的一端扑入。黑一子还有另一端一口气，因此不是自杀。'),
            ((4, 3), '白棋填另一端提走黑一子，但外面没有气，整块只剩刚腾出的空点。'),
            ((3, 3), '回到原处提掉整块白棋；中央也能形成倒扑。')], [
            ((4, 3), '从两点空位的另一端扑入，同样保留一口气。'),
            ((3, 3), '白棋提走扑入的一子，整块只剩腾出的空点。'),
            ((4, 3), '在原处回提，两个方向都能完成这道题。')]],
        '不要只认角上的外形。数白棋提走黑子后，整块还剩几口气。')
    snapback['concept'] = 'snapback'
    return [chase, snapback]

if __name__ == '__main__':
    lessons = build()
    (Path(__file__).parent / 'diverse.json').write_text(json.dumps(lessons, ensure_ascii=False, indent=2) + '\n')
    print('Built', len(lessons), 'distinct exercises, including both symmetric snapback answers.')
