"""Build original short capture exercises. No copied or generated book content."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from go_rules import play,key,group
import tactics
BASE=Path(__file__).resolve().parent

def boundary(white,ports):
 w=set(white);return sorted({q for x,y in white for q in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)) if 0<=q[0]<9 and 0<=q[1]<9}-w-set(ports))
def chase(white,p,q,r):
 blacks=set(boundary(white,[p,q]))
 blacks|=set(boundary([q],[r,p]))-set(white)
 return sorted(blacks),[[(p,'先封住一个出口，让目标整块只剩一口气。'),(q,'白棋从另一个出口长出；重新数连接后整块棋的气。'),(r,'占住延伸后最后一口气，提掉目标整块。')]]
def double(a,b,p,qa,qb):
 whites=a+b;black=boundary(whites,[p,qa,qb])
 return black,[[(p,'占住两块白棋共同的一口气，同时打吃。'),(qa,'白棋选择救第一块，另一块仍被打吃。'),(qb,'提掉没有逃出的第二块，完成任提一块的目标。')],[(p,'占住两块白棋共同的一口气，同时打吃。'),(qb,'白棋选择救第二块，另一块仍被打吃。'),(qa,'提掉没有逃出的第一块，完成任提一块的目标。')]]
def make(i,title,concept,blacks,whites,targets,lines,kind='capture'):
 lesson=tactics._lesson(f'original-l3-{i:02}',title,3,blacks,whites,targets,lines,'重点是'+concept+'。先数整块棋的气，再算白棋应手后的最后一口气。',kind)
 lesson['concept']={'双打吃':'double_atari','倒扑':'snapback','接不归':'connection_trap','打吃追赶':'edge_chase','整块打吃':'atari','短征吃':'ladder'}[concept]
 lesson['source']['note']='原创短变化训练；只核对收录变化合法且目标确实被提，不宣称穷尽防守或唯一最佳着。'
 return lesson

lessons=[]
def add(title,concept,black,white,targets,lines,kind='capture'):
 try: lessons.append(make(len(lessons)+1,title,concept,black,white,targets,lines,kind))
 except ValueError as error: raise ValueError(title + ': ' + str(error)) from error
for title,a,b,p,qa,qb in [
 ('双打吃：三子弯块与两子竖块',[(2,3),(2,4),(1,4)],[(4,3),(4,2)],(3,3),(1,5),(4,1)),
 ('双打吃：横块与向下四子弯块',[(3,2),(4,2)],[(3,4),(2,4),(2,5),(2,6)],(3,3),(5,2),(1,6)),
]:
 black,lines=double(a,b,p,qa,qb);add(title,'双打吃',black,a+b,[a[0],b[0]],lines,'capture_any')
add('倒扑：送一子，回提弯曲四子','倒扑',[(2,1),(1,2),(0,3)],[(2,0),(0,1),(1,1),(0,2)],[(0,1),(1,1),(0,2)],[[((1,0),'先扑入一颗黑子；它只剩角上一口气，准备让白棋提走。'),((0,0),'白棋提掉扑入的黑子，但整块白棋只剩刚腾出的一个空点。'),((1,0),'在原来的位置回提，提掉四颗白棋，局面没有还原成劫。')]])
add('接不归：连上另一块也逃不掉','接不归',[(1,2),(2,1),(1,3),(2,4),(3,4)],[(2,2),(3,3)],[(2,2)],[[((3,2),'从右侧打吃上方目标白棋。'),((2,3),'白棋向下连接同伴，但相连后整块也只剩右侧一口气。'),((4,3),'占掉整块最后一口气，目标和新接上的白棋一起被提掉。')],[((3,2),'从右侧打吃上方目标白棋。'),((4,3),'白棋救下方同伴，舍弃上方目标。'),((2,3),'占掉上方目标最后一口气，完成提子。')]])
for title,white,p,q,r in [
 ('一线追吃：三颗横排白棋',[(2,0),(3,0),(4,0)],(1,0),(5,0),(6,0)),
 ('边线追吃：向内拐出的三子',[(0,3),(0,4),(1,4)],(0,2),(0,5),(0,6)),
 ('转角紧气：角上六子寻找出口',[(0,0),(1,0),(0,1),(1,1),(2,1),(2,0)],(3,0),(0,2),(0,3)),
 ('寻找出口：钩形棋块向右长',[(0,2),(1,2),(1,3),(1,4)],(0,1),(2,4),(3,4)),
 ('共享气：边上的T形棋块',[(3,7),(4,7),(5,7),(4,8)],(3,8),(6,7),(7,7)),
 ('整块追吃：方形白棋向右长',[(4,3),(5,3),(4,4),(5,4)],(3,3),(6,4),(7,4)),
]:
 black,lines=chase(white,p,q,r);add(title,'整块打吃' if title.startswith('整块追吃') else '打吃追赶',black,white,white,lines)
add('短征吃：转一次弯就能提','短征吃',[(1,2),(2,1),(1,3),(3,4)],[(2,2)],[(2,2)],[[((3,2),'从右侧打吃，把白棋引向下方。'),((2,3),'白棋向下长，整块有右、下两口气。'),((2,4),'再从下方打吃，让白棋向右转。'),((3,3),'白棋右转后遇到下方黑子，只剩右侧一口气。'),((4,3),'占掉最后一口气，提掉这条白棋。')]])
add('短征吃：两子一起被追赶','短征吃',[(1,2),(2,1),(3,1),(4,2),(4,4)],[(2,2),(3,2)],[(2,2),(3,2)],[[((2,3),'紧住左下方的气，打吃相连的两颗白棋。'),((3,3),'白棋向下长，整块仍有右、下两口气。'),((3,4),'从下面继续打吃，迫使白棋向右转。'),((4,3),'白棋转向右侧，却被下方已有黑子限制，只剩右边一口气。'),((5,3),'占据最后一口气，提掉整块白棋。')]])


for title,white in [
 ('倒扑：回提沿边伸长的五子',[(0,1),(1,1),(0,2),(0,3)]),
 ('倒扑：回提两列相连的六子',[(0,1),(1,1),(0,2),(1,2),(0,3)]),
]:
 black=boundary(white+[(0,0)],[(1,0)])
 add(title,'倒扑',black,white+[(2,0)],white,[[((1,0),'扑入一子，只保留角上一口气，准备让白棋提走。'),((0,0),'白棋提掉扑入的一子，连接后的整块只剩腾出的空点。'),((1,0),'在原处回提整块白棋，完成倒扑。')]])
for title,lower in [
 ('接不归：两子竖块接上也无路',[(3,3),(3,4)]),
 ('接不归：三子弯块越接越重',[(3,3),(3,4),(4,4)]),
]:
 white=[(2,2)]+lower
 black=sorted(set(boundary(white,[(3,2),(2,3),(4,3)]))|{(1,3)})
 add(title,'接不归',black,white,[(2,2)],[[((3,2),'打吃上方的目标白棋，留意下方同伴的气。'),((2,3),'白棋向下连接同伴，但整块只剩右侧一口气。'),((4,3),'填掉最后一口气，连上的整块也被提走。')],[((3,2),'打吃上方目标。'),((4,3),'白棋救下方同伴，放弃上方目标。'),((2,3),'提掉上方目标，完成任务。')]])
add('短征吃：三子弯块连续转向','短征吃',[(1,2),(2,1),(3,0),(4,1),(4,2),(4,4)],[(2,2),(3,2),(3,1)],[(2,2),(3,2),(3,1)],[[((2,3),'从左下紧气，打吃整块三颗白棋。'),((3,3),'白棋向下长，剩下右、下两口气。'),((3,4),'从下方继续打吃，白棋必须再转向。'),((4,3),'白棋右转，下方黑棋限制了出口，只剩右侧一口气。'),((5,3),'占住最后一口气，提掉连起来的五颗白棋。')]])

def fingerprint(l):
 variants=[]
 for flip in (False,True):
  for turns in range(4):
   points=[]
   for p in l['stones']:
    x,y=p['x'],p['y']
    if flip:x=8-x
    for _ in range(turns):x,y=8-y,x
    points.append((x,y,p['color']))
   mx=min(p[0] for p in points);my=min(p[1] for p in points)
   variants.append(tuple(sorted((x-mx,y-my,c) for x,y,c in points)))
 return min(variants)
seen={fingerprint(l) for l in tactics.catalog()};records=[]
for lesson in lessons:
 checked=tactics.validate_lesson(lesson)
 assert checked['difficulty']==3 and checked['size']==9
 signature=fingerprint(lesson);assert signature not in seen,lesson['id'];seen.add(signature)
 board=[[0]*9 for _ in range(9)]
 for p in lesson['stones']:board[p['y']][p['x']]=p['color']
 paths=[]
 def walk(node,board,seen,depth,captures,liberties):
  if not node['children']:paths.append({'plies':depth,'captures_per_ply':captures,'played_group_liberties':liberties});return
  for child in node['children']:
   after,n=play(board,*child['move'],1 if depth%2==0 else 2,seen)
   libs=len(group(after,*child['move'])[1])
   if depth==0 and lesson['concept']!='snapback':
    assert all(len(group(after,*target)[1])==1 for target in lesson['objective']['targets']),lesson['id']
   if lesson['concept']=='snapback' and depth in (0,1): assert libs==1,lesson['id']
   if depth==1 and lesson['concept']=='ladder': assert libs==2,lesson['id']
   if depth==1 and lesson['concept'] in ('edge_chase','atari'): assert libs==1,lesson['id']
   if depth==3 and lesson['concept']=='ladder': assert libs==1,lesson['id']
   walk(child,after,seen+[key(after)],depth+1,captures+[n],liberties+[libs])
 walk(lesson['tree'],board,[key(board)],0,[],[])
 assert all(p['plies']>=3 for p in paths)
 records.append({'id':lesson['id'],'title':lesson['title'],'concept':lesson['concept'],'difficulty':3,'size':9,'initial_stones':len(lesson['stones']),'branches':len(paths),'min_plies':min(p['plies']for p in paths),'max_plies':max(p['plies']for p in paths),'verified_paths':paths})
(BASE/'lessons.json').write_text(json.dumps(lessons,ensure_ascii=False,indent=2)+'\n')
(BASE/'validation.json').write_text(json.dumps({'count':len(lessons),'rotation_reflection_translation_distinct':True,'distinct_from_existing_tactics':True,'records':records},ensure_ascii=False,indent=2)+'\n')
print(json.dumps(records,ensure_ascii=False,indent=2))
