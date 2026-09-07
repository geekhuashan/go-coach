#!/usr/bin/env python3
"""Reproducibly convert licensed Go Game Guru SGF problems, failing closed.

No upstream parser code is reused. The retained raw data and derived lessons
are CC BY-NC-SA 4.0; this script does not change this project's code license.
Only author comments explicitly beginning Correct/Also correct/This is also
correct establish a successful node. Unmarked variations are never labeled
wrong or successful by inference from branch order.
"""
import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import urllib.request
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from go_rules import group, key, play

COMMIT='eee12b2e39d59dbe81a8b9eaa7d4f103978d9224'
REPO='https://github.com/gogameguru/go-problems'
DATA=Path(__file__).resolve().parents[1]/'data'/'gogameguru'
SUCCESS=re.compile(r'^(?:(?:Also\s+)|(?:This\s+is\s+also\s+))?correct\b',re.I)


class SGFError(ValueError):pass


class Parser:
    def __init__(self,source):self.source=source;self.i=0;self.nodes=0
    def space(self):
        while self.i<len(self.source) and self.source[self.i].isspace():self.i+=1
    def expect(self,character):
        self.space()
        if self.i>=len(self.source) or self.source[self.i]!=character:raise SGFError('unexpected SGF token')
        self.i+=1
    def value(self):
        self.expect('[');out=[]
        while self.i<len(self.source):
            c=self.source[self.i];self.i+=1
            if c==']':return ''.join(out)
            if c=='\\':
                if self.i>=len(self.source):raise SGFError('unfinished escape')
                c=self.source[self.i];self.i+=1
                if c in '\r\n':
                    if self.i<len(self.source) and self.source[self.i] in '\r\n' and self.source[self.i]!=c:self.i+=1
                    continue
            out.append(c)
        raise SGFError('unfinished property value')
    def node(self):
        self.expect(';');self.nodes+=1
        if self.nodes>20000:raise SGFError('too many nodes')
        props={}
        while True:
            self.space();start=self.i
            while self.i<len(self.source) and 'A'<=self.source[self.i]<='Z':self.i+=1
            if start==self.i:break
            name=self.source[start:self.i]
            if name in props:raise SGFError('repeated property')
            values=[]
            while True:
                self.space()
                if self.i>=len(self.source) or self.source[self.i]!='[':break
                values.append(self.value())
            if not values:raise SGFError('property without value')
            props[name]=values
        return {'props':props,'children':[]}
    def tree(self,depth=0):
        if depth>500:raise SGFError('tree too deep')
        self.expect('(');self.space()
        if self.i>=len(self.source) or self.source[self.i]!=';':raise SGFError('empty game tree')
        first=current=self.node()
        while True:
            self.space()
            if self.i>=len(self.source) or self.source[self.i]!=';':break
            child=self.node();current['children'].append(child);current=child
        while True:
            self.space()
            if self.i>=len(self.source) or self.source[self.i]!='(':break
            current['children'].append(self.tree(depth+1))
        self.expect(')');return first
    def parse(self):
        root=self.tree();self.space()
        if self.i!=len(self.source):raise SGFError('multiple games or trailing data')
        return root


def coord(value,size):
    if len(value)!=2 or any(not 'a'<=c<=chr(96+size) for c in value):raise SGFError('unsupported or out-of-bounds coordinate')
    return [ord(c)-97 for c in value]


def setup(root):
    p=root['props']
    size=int(p.get('SZ',['19'])[0])
    if size not in (9,19):raise SGFError('unsupported size')
    if p.get('GM',['1'])!=['1']:raise SGFError('not Go')
    board=[[0]*size for _ in range(size)];stones=[]
    for prop,color in (('AB',1),('AW',2)):
        for raw in p.get(prop,[]):
            if ':' in raw:raise SGFError('compressed setup not implemented')
            x,y=coord(raw,size)
            if board[y][x]:raise SGFError('duplicate setup')
            board[y][x]=color;stones.append(dict(x=x,y=y,color=color))
    if not stones:raise SGFError('no setup')
    for stone in stones:
        if not group(board,stone['x'],stone['y'])[1]:raise SGFError('zero-liberty initial group')
    first_colors={1 if 'B' in child['props'] else 2 if 'W' in child['props'] else 0 for child in root['children']}
    if len(first_colors)!=1 or 0 in first_colors:raise SGFError('ambiguous first player')
    player=next(iter(first_colors))
    if 'PL' in p and p['PL']!=['B' if player==1 else 'W']:raise SGFError('PL contradicts moves')
    if any(prop in p for prop in ('B','W','AE')):raise SGFError('root setup/move unsupported')
    return size,board,stones,player


def analyze(root,size,board,player):
    stats={'raw_nodes':0,'raw_leaves':0,'raw_max_ply':0,'positive_markers':0,'passes':0}
    errors=[]
    def visit(node,before,seen,color,depth,path):
        stats['raw_nodes']+=1;stats['raw_max_ply']=max(stats['raw_max_ply'],depth)
        p=node['props'];comment='\n'.join(p.get('C',[])).strip()
        if SUCCESS.match(comment):stats['positive_markers']+=1
        if not node['children']:stats['raw_leaves']+=1
        # Every raw variation, including discarded/unmarked responses, is
        # independently replayed. No illegal SGF move is silently corrected.
        try:
            if any(k in p for k in ('AB','AW','AE','PL')):raise SGFError('setup change inside variation')
            expected='B' if color==1 else 'W'
            if expected not in p or ('W' if color==1 else 'B') in p or len(p[expected])!=1:raise SGFError('nonalternating/missing move')
            raw=p[expected][0]
            if raw in ('','tt'):
                stats['passes']+=1
                after=before
            else:after,_=play(before,*coord(raw,size),color,seen)
        except (ValueError,SGFError) as exc:
            errors.append({'path':path,'reason':str(exc),'ply':depth})
            return
        for index,child in enumerate(node['children']):visit(child,after,seen+(key(after),),3-color,depth+1,path+[index])
    for index,child in enumerate(root['children']):visit(child,board,(key(board),),player,1,[index])
    return stats,errors


def positive_tree(root,size,player):
    # Stop at an explicit successful author node, retaining the comment as
    # evidence. Optional follow-up demonstrations remain in the original SGF.
    def extract(node,color):
        p=node['props'];comment='\n'.join(p.get('C',[])).strip();raw=p['B' if color==1 else 'W'][0]
        positive=bool(SUCCESS.match(comment))
        children=[] if positive else [out for child in node['children'] if (out:=extract(child,3-color)) is not None]
        if not positive and not children:return None
        if raw in ('','tt'):raise SGFError('pass in activated path unsupported')
        out={'move':coord(raw,size),'explanation':comment or ('按作者收录的变化继续计算。' if color==player else '对手按作者收录的变化应手。'),'children':children}
        if positive:
            out.update(result='success',author_verdict='correct')
        return out
    tree={'children':[out for child in root['children'] if (out:=extract(child,player)) is not None]}
    if not tree['children']:raise SGFError('no explicit author success')
    return tree


def verify_active(tree,board,player):
    count=0;depths=[]
    def visit(node,before,seen,color,depth):
        nonlocal count
        count+=1
        if count>256 or depth>31:raise SGFError('activated tree exceeds 256 nodes / 31 plies')
        moves=[tuple(c['move']) for c in node['children']]
        if len(moves)>16 or len(moves)!=len(set(moves)):raise SGFError('too many or duplicate variations')
        if not node['children']:
            if node.get('result')!='success' or node.get('author_verdict')!='correct' or not SUCCESS.match(node.get('explanation','')):raise SGFError('unproven terminal')
            depths.append(depth)
        for child in node['children']:
            after,_=play(before,*child['move'],color,seen)
            visit(child,after,seen+(key(after),),3-color,depth+1)
    visit(tree,board,(key(board),),player,0)
    return {'nodes':count,'min_ply':min(depths),'max_ply':max(depths),'success_leaves':len(depths)}


def download(base):
    blob=urllib.request.urlopen(f'https://codeload.github.com/gogameguru/go-problems/zip/{COMMIT}',timeout=60).read()
    archive=zipfile.ZipFile(io.BytesIO(blob))
    for name in archive.namelist():
        rel='/'.join(name.split('/')[1:])
        if '..' in Path(rel).parts:raise SGFError('unsafe archive path')
        if rel in ('LICENSE','README.md') or rel.endswith('.sgf'):
            dest=base/('raw/'+rel if rel.endswith('.sgf') else 'UPSTREAM_'+rel)
            dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(archive.read(name))


def build(base):
    lessons=[];records=[]
    for level,difficulty,label in (('easy',3,'基础'),('intermediate',4,'进阶'),('hard',5,'挑战')):
        files=sorted((base/'raw'/'weekly-go-problems'/level).glob('*.sgf'))
        if len(files)!=140:raise SGFError(f'expected 140 {level} files, got {len(files)}')
        for f in files:
            rel=f.relative_to(base/'raw').as_posix()
            record={'id':f.stem,'path':rel,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'level':level,'active':False}
            try:
                root=Parser(f.read_text(encoding='utf-8-sig')).parse()
                size,board,stones,player=setup(root)
                stats,errors=analyze(root,size,board,player);record.update(stats)
                if errors:
                    record['errors']=errors;raise SGFError('raw variation failed legal replay')
                tree=positive_tree(root,size,player)
                record['active_tree']=verify_active(tree,board,player)
                title=f'Go Game Guru · {label} {int(f.stem.rsplit("-",1)[1])}'
                comment='\n'.join(root['props'].get('C',[])).strip()
                marks=[]
                for lb in root['props'].get('LB',[]):
                    point,labeltext=lb.split(':',1);x,y=coord(point,size);marks.append(dict(x=x,y=y,label=labeltext))
                for tr in root['props'].get('TR',[]):
                    x,y=coord(tr,size);marks.append(dict(x=x,y=y,label='△'))
                lesson=dict(id=f.stem,title=title,prompt=('黑先。' if player==1 else '白先。')+'完成作者收录的局部计算变化；可能涉及做活、杀棋、劫或手筋。完成表示达到作者标记的解答，不是程序独立判定死活。',hint='先数相关棋块的气并计算对手应手；未收录走法暂不判错。',size=size,to_play=player,skill='tsumego',difficulty=difficulty,sequence=True,stones=stones,marks=marks,objective={'kind':'authored_solution'},tree=tree,source=dict(kind='licensed',title='Go Game Guru Weekly Go Problems',problem=f.stem,author='David Ormerod and An Younggil / Go Game Guru',attribution='Go Game Guru Weekly Go Problems by David Ormerod and An Younggil, CC BY-NC-SA 4.0; converted from SGF with original comments retained.',license='CC BY-NC-SA-4.0',url=f'{REPO}/blob/{COMMIT}/{rel}',commit=COMMIT,note='SGF C comments explicitly mark Correct / Also correct / This is also correct. Original comments retained. Raw SGF uses Japanese rules; every activated branch also passes this app positional-superko rules.',original_prompt=comment))
                lessons.append(lesson);record['active']=True
            except (SGFError,ValueError,IndexError,KeyError) as exc:
                record['inactive_reason']=str(exc)
            records.append(record)
    base.mkdir(parents=True,exist_ok=True)
    (base/'lessons.json').write_text(json.dumps(lessons,ensure_ascii=False,indent=2)+'\n')
    report={'repository':REPO,'commit':COMMIT,'license':'CC BY-NC-SA-4.0','authors':['David Ormerod','An Younggil'],'source_count':len(records),'active_count':len(lessons),'inactive_count':len(records)-len(lessons),'active_by_level':dict(Counter(r['level'] for r in records if r['active'])),'inactive_reasons':dict(Counter(r.get('inactive_reason') for r in records if not r['active'])),'records':records}
    (base/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='records'},ensure_ascii=False,indent=2))
    return report


def self_test():
    # Escaped brackets and backslashes remain text, never become tree tokens.
    root=Parser('(;SZ[9]C[a\\]b\\\\c](;B[aa]C[Correct])(;B[bb]C[Wrong]))').parse()
    assert root['props']['C']==['a]b\\c']
    assert len(root['children'])==2
    assert SUCCESS.match('Correct, but not the best.')
    assert SUCCESS.match('Also correct.')
    assert SUCCESS.match('This is also correct.')
    assert not SUCCESS.match('Almost correct, but wrong.')
    assert not SUCCESS.match('This move is not correct.')
    try:Parser('(;C[unfinished)').parse()
    except SGFError:pass
    else:raise AssertionError('bad SGF accepted')
    print('Parser and explicit author-marker checks passed.')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--download',action='store_true',help='Fetch the pinned upstream snapshot; no Git push/cloud upload')
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--data-dir',type=Path,default=DATA)
    args=p.parse_args()
    if args.self_test:self_test()
    if args.download:download(args.data_dir)
    build(args.data_dir)


if __name__=='__main__':main()
