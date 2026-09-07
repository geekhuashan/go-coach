"""Export conservative, exact-path author refutations from the pinned raw SGF.

Does not label an unannotated branch wrong or infer an earlier move's result
from a later continuation. No engine score or automatic life/death claim.
"""
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parents[1]))
from go_rules import key, play
from scripts.import_gogameguru import Parser, SUCCESS, coord, setup

# Exact comments manually reviewed for explicit failure, not merely inferior
# style, an optional continuation, or an opponent's mistake. All apply only
# to black-to-play lessons; those are the named failing side in the comments.
FAILURE_COMMENTS = {
    "Black can't make two eyes.",
    "Black can't make two eyes now.",
    "Black can't make two eyes now. A is a false eye because it's not connected to the rest of the group with a Black stone at B.",
    "Black can't make two eyes now. Later if White wants to take these stones off the board for some reason, White can exchange A for B, then fill the outside liberties with C and D. Capturing White's stones will only give Black one eye.",
    "White will play here and now Black's corner stones are captured.",
    "Black doesn't have enough liberties to make a ko, so Black dies.",
    "Even if Black plays at A or B next, White can ignore it and Black's still dead.",
    "After White 4 here, there's no way to live.",
    "Black A has been captured in a ladder. This result is bad for Black.",
    "Capturing at A only makes a false eye, so Black dies.",
    "Black only has one eye, so Black's dead.",
    "Capturing at A only makes a false eye, so Black's already died.",
    "This is the vital point. Black will die after White plays here.",
    "A is a false eye, so Black's group will be captured.",
    "Eventually Black will have to capture White's three stones, and Black will die.",
    "Black can't capture White so Black's stones are all dead.",
    "Black's dead.",
    "Black's already died.",
    "A and B are miai. Black's dead.",
    "Black's stones are captured.",
    "Black's stones are captured, and he still has to play A in the lower left.",
    "Black's dead. Even if Black ataris at A now, White can ignore it because Black still can't make two eyes.",
    "Black only has one eye at best, so Black's dead.",
    "Black usually needs three liberties to make this work, but he only has two. Black's dead.",
    "Black has weaknesses at A and B, but only has time to fix one of them, so Black's dead.",
    "This ladder doesn't work for Black.",
    "This ladder doesn't work for Black because of A.",
    "This ladder doesn't work for Black, because of A.",
    "This ladder doesn't work for Black, because Black A is in atari.",
    "Almost correct, but Black can't atari now, so White lives. Be careful towards the end of the ladder.",
}



# Human-written Chinese explanations; keys retain the exact author evidence.
REASONS_ZH = {
    "Black can't make two eyes.": "这块黑棋做不出两个真眼，无法做活。",
    "Black can't make two eyes now.": "走到这里，黑棋已经做不出两个真眼了。",
    "Black can't make two eyes now. A is a false eye because it's not connected to the rest of the group with a Black stone at B.": "黑棋做不出两个真眼。B处缺一颗黑子，棋形没有连好，所以A只是假眼。",
    "Black can't make two eyes now. Later if White wants to take these stones off the board for some reason, White can exchange A for B, then fill the outside liberties with C and D. Capturing White's stones will only give Black one eye.": "黑棋做不出两个真眼。白棋以后可先交换A、B，再用C、D收紧外气；黑棋即使提掉里面的白子，也只能得到一个眼。",
    "White will play here and now Black's corner stones are captured.": "白棋应在这里后，角上的黑棋就被吃住了。",
    "Black doesn't have enough liberties to make a ko, so Black dies.": "黑棋的气不够，连打劫的机会也没有，这块棋无法做活。",
    "Even if Black plays at A or B next, White can ignore it and Black's still dead.": "黑棋下一手即使走A或B，白棋也不必应，黑棋仍然无法做活。",
    "After White 4 here, there's no way to live.": "白棋第4手走到这里后，黑棋已经没有做活的办法。",
    "Black A has been captured in a ladder. This result is bad for Black.": "A处的黑棋被征吃吃住了，这个结果对黑棋不利。",
    "Capturing at A only makes a false eye, so Black dies.": "黑棋在A提子后得到的只是假眼，仍然无法做活。",
    "Black only has one eye, so Black's dead.": "黑棋只有一个眼，这块棋无法做活。",
    "Capturing at A only makes a false eye, so Black's already died.": "在A提子也只能做出假眼，黑棋已经无法做活。",
    "This is the vital point. Black will die after White plays here.": "这里是要点。白棋占住后，黑棋就无法做活。",
    "A is a false eye, so Black's group will be captured.": "A只是假眼，不能保护整块黑棋，黑棋会被吃掉。",
    "Eventually Black will have to capture White's three stones, and Black will die.": "黑棋最后必须提掉这三颗白子，但提完以后仍无法做活。",
    "Black can't capture White so Black's stones are all dead.": "黑棋吃不住白棋，自己的这一整块棋也无法做活。",
    "Black's dead.": "走到这里，这块黑棋已经无法做活。",
    "Black's already died.": "黑棋已经成了死棋，接下来也无法做活。",
    "A and B are miai. Black's dead.": "A和B互为见合：黑棋防住一处，白棋就走另一处，黑棋仍无法做活。",
    "Black's stones are captured.": "这块黑棋被吃住了。",
    "Black's stones are captured, and he still has to play A in the lower left.": "这块黑棋被吃住了，而且黑棋还得回到左下角补A。",
    "Black's dead. Even if Black ataris at A now, White can ignore it because Black still can't make two eyes.": "黑棋在A打吃也救不活：白棋可以不应，黑棋仍做不出两个真眼。",
    "Black only has one eye at best, so Black's dead.": "黑棋最多只能做出一个眼，因此无法做活。",
    "Black usually needs three liberties to make this work, but he only has two. Black's dead.": "这套走法通常需要三口气，黑棋却只有两口，所以无法做活。",
    "Black has weaknesses at A and B, but only has time to fix one of them, so Black's dead.": "黑棋在A和B都有缺陷，却只来得及补一处，因此仍然无法做活。",
    "This ladder doesn't work for Black.": "黑棋这条征吃路线走不通，不能按这样继续追。",
    "This ladder doesn't work for Black because of A.": "A处让黑棋这条征吃路线走不通，请特别留意那里。",
    "This ladder doesn't work for Black, because of A.": "A处让黑棋这条征吃路线走不通，请特别留意那里。",
    "This ladder doesn't work for Black, because Black A is in atari.": "A处的黑棋自己被打吃了，因此黑棋不能继续按这条路线征吃。",
    "Almost correct, but Black can't atari now, so White lives. Be careful towards the end of the ladder.": "前面接近正确，但最后黑棋已经不能打吃，白棋因此活了。征吃快结束时也要数清气。",
}
assert set(REASONS_ZH) == FAILURE_COMMENTS

def active_prefixes(tree):
    found = set()
    def walk(node, moves):
        found.add(tuple(map(tuple, moves)))
        for child in node['children']:
            walk(child, moves + [child['move']])
    walk(tree, [])
    return found


def build():
    lessons = {l['id']: l for l in json.loads((BASE / 'lessons.json').read_text())}
    output, evidence = {}, []
    stats = Counter()
    rejects = []
    for file in sorted((BASE / 'raw').rglob('*.sgf')):
        if file.stem not in lessons:
            continue
        lesson = lessons[file.stem]
        stats['lessons_scanned'] += 1
        raw = file.read_bytes()
        root = Parser(raw.decode('utf-8')).parse()
        size, initial, stones, player = setup(root)
        assert size == lesson['size'] and player == lesson['to_play']
        assert sorted((s['x'],s['y'],s['color']) for s in stones) == sorted((s['x'],s['y'],s['color']) for s in lesson['stones'])
        positive = active_prefixes(lesson['tree'])
        entries = {}

        def visit(node, board, seen, color, moves, indexes, comments, captures):
            props = node['props']
            comment = '\n'.join(props.get('C', [])).strip()
            stats['raw_move_nodes_scanned'] += 1
            if re.search(r'\b(?:incorrect|wrong|refut\w*)\b', comment, re.I):
                stats['literal_wrong_keyword_nodes'] += 1
            if SUCCESS.match(comment):
                stats['positive_subtrees_skipped'] += 1
                return
            is_failure = player == 1 and comment in FAILURE_COMMENTS
            if is_failure:
                stats['allowlisted_markers_seen'] += 1
            try:
                if any(p in props for p in ('AB','AW','AE','PL')):
                    raise ValueError('setup changed inside path')
                expected = 'B' if color == 1 else 'W'
                if expected not in props or ('W' if color == 1 else 'B') in props or len(props[expected]) != 1:
                    raise ValueError('nonalternating or missing move')
                raw_move = props[expected][0]
                if raw_move in ('', 'tt'):
                    raise ValueError('pass path deliberately unsupported')
                move = coord(raw_move, size)
                after, removed = play(board, *move, color, seen)
            except ValueError as error:
                stats['unsupported_subtrees_skipped'] += 1
                rejects.append({'lesson_id': file.stem, 'node_path': indexes, 'reason': str(error)})
                return
            full = moves + [move]
            full_comments = comments + [comment]
            full_captures = captures + [removed]
            if is_failure:
                # A marker on Black's own move uses that exact position. A
                # marker on the immediately following White move supplies
                # exactly that reply, never hypothetical later Black errors.
                prefix = full if color == player else full[:-1]
                pv = [] if color == player else [move]
                signature = tuple(map(tuple, prefix))
                if not prefix or signature in positive:
                    stats['active_or_empty_prefix_skipped'] += 1
                elif len(prefix) > 31:
                    stats['over_31_ply_prefix_skipped'] += 1
                else:
                    assert len(prefix) % 2 == 1
                    # Preserve SGF labels because comments often refer to A/B.
                    labels = []
                    for label in props.get('LB', []):
                        xy, text = label.split(':', 1)
                        labels.append({'move': coord(xy, size), 'label': text})
                    entry = {
                        'moves': prefix,
                        'verdict': 'author_refuted',
                        'reason': comment,
                        'reason_zh': REASONS_ZH[comment],
                        'pvReply': pv,
                        'evidence_moves': full,
                        'evidence_at': 'reply' if pv else 'move',
                        'source_path': str(file.relative_to(BASE / 'raw')) + '#node=' + '.'.join(map(str,indexes)),
                        'evidence_labels': labels,
                        'source': {
                            'kind': 'licensed',
                            'url': lesson['source']['url'],
                            'license': lesson['source']['license'],
                            'attribution': lesson['source']['attribution'],
                            'sgf_node_path': indexes,
                            'comment': comment,
                        },
                    }
                    # If two immediate opponent replies refute one exact
                    # prefix, retain one deterministic shortest demonstration.
                    old = entries.get(signature)
                    if old is None or len(pv) < len(old['pvReply']):
                        entries[signature] = entry
                        evidence.append({'lesson_id': file.stem, 'node_path': indexes, 'moves': full, 'captures_per_ply': full_captures, 'source_sha256': hashlib.sha256(raw).hexdigest()})
                    stats['legal_allowlisted_markers'] += 1
            for index, child in enumerate(node['children']):
                visit(child, after, seen + (key(after),), 3-color, full, indexes+[index], full_comments, full_captures)

        for index, child in enumerate(root['children']):
            visit(child, initial, (key(initial),), player, [], [index], [], [])
        if entries:
            output[file.stem] = sorted(entries.values(), key=lambda e: (len(e['moves']), e['moves']))

    # Independent second replay of all exported exact prefixes and evidence.
    for identity, entries in output.items():
        lesson = lessons[identity]
        for entry in entries:
            board = [[0]*lesson['size'] for _ in range(lesson['size'])]
            for stone in lesson['stones']:
                board[stone['y']][stone['x']] = stone['color']
            seen = [key(board)]
            assert entry['moves'] + entry['pvReply'] == entry['evidence_moves']
            assert entry['reason'] in FAILURE_COMMENTS
            for index, move in enumerate(entry['evidence_moves']):
                board, _ = play(board, *move, lesson['to_play'] if index % 2 == 0 else 3-lesson['to_play'], seen)
                seen.append(key(board))
    stats['first_offbook_prefixes'] = sum(tuple(map(tuple,e['moves'][:-1])) in active_prefixes(lessons[identity]['tree']) for identity,entries in output.items() for e in entries)
    stats['first_offbook_lessons'] = sum(any(tuple(map(tuple,e['moves'][:-1])) in active_prefixes(lessons[identity]['tree']) for e in entries) for identity,entries in output.items())
    stats['exported_lessons'] = len(output)
    stats['exported_exact_prefixes'] = sum(map(len, output.values()))
    stats['with_immediate_refutation_reply'] = sum(bool(e['pvReply']) for es in output.values() for e in es)
    (BASE / 'review-variations.json').write_text(json.dumps({'version': 1, 'lessons': output}, ensure_ascii=False, indent=2)+'\n')
    validation = {'stats': dict(stats), 'scope': 'Exact full history only; author judgment, no independent life/death or global-score judgment. Unmarked and merely suboptimal branches remain unknown.', 'rejected_subtrees': rejects, 'replay_evidence': evidence}
    (BASE / 'review-variations-validation.json').write_text(json.dumps(validation, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(dict(stats), indent=2))


if __name__ == '__main__':
    build()
