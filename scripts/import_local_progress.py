#!/usr/bin/env python3
"""Explicit, non-destructive upload of schema-2 Go learning progress."""
import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from publish_lesson import Client, TransferError, MAX_BYTES, read_json, validate_lesson

# Only Go state/feedback fields are accepted below. Unknown data, settings,
# credentials, images and attachment paths are never included in the request.
PROFILE_FIELDS = {'id','name','state','attempts','notes','helped_lesson_ids','lesson_runs','created_at','llm_explanations'}
MATCH_FIELDS = {'id','mode','players','move_number','ended','updated_at','version','state'}
STATE_FIELDS = set('last_human_assessment assessment assisted revision size board to_play move_number captures last_move mode lesson message marks history ended feedback passes demo_active lesson_attempted demo_step demo_total initial_board initial_player moves match match_id _match_version lesson_progress _branch_seed inspection'.split())
NESTED_FIELDS = set('id title prompt hint skill difficulty variant size to_play stones objective targets kind point marks x y color label tree children move explanation sequence source page problem note name text created_at updated_at profile_id lesson_id correct assisted attempt_no summary status completed user_moves total_moves ply path black white type human_color mode ended version move_number revision pass captured liberties count remaining steps available last_human_assessment assessment lessons profile_name model question context_key'.split())
NESTED_FIELDS |= STATE_FIELDS | {'result','author_verdict'}


def sanitize_store(value):
    if not isinstance(value, dict) or type(value.get('schema')) is not int or value['schema'] != 2:
        raise TransferError('仅支持 schema=2 的围棋学习档案。')
    if type(value.get('revision')) is not int or value['revision'] < 0:
        raise TransferError('本机档案 revision 无效。')
    profiles = value.get('profiles')
    if not isinstance(profiles, dict) or not 1 <= len(profiles) <= 20:
        raise TransferError('学习者列表需要 1–20 项。')
    if value.get('active_profile_id') not in profiles:
        raise TransferError('当前学习者引用无效。')

    def safe(item, depth=0):
        if depth > 60:
            raise TransferError('学习档案嵌套过深。')
        if item is None or type(item) in (str, int, bool):
            return item
        if type(item) is float and math.isfinite(item):
            return item
        if isinstance(item, list):
            return [safe(v, depth+1) for v in item]
        if isinstance(item, dict):
            fields = NESTED_FIELDS
            if item.get('kind') == 'licensed':
                fields = fields | {'author','license','url','commit','attribution','original_prompt'}
            return {k:safe(v, depth+1) for k,v in item.items() if k in fields}
        raise TransferError('学习档案包含不支持的数据类型。')

    def board_state(state):
        if not isinstance(state, dict):
            raise TransferError('学习局面格式无效。')
        size = state.get('size', 9)
        board = state.get('board')
        if type(size) is not int or size not in (9,19) or not isinstance(board,list) or len(board)!=size:
            raise TransferError('学习局面棋盘尺寸无效。')
        if any(not isinstance(row,list) or len(row)!=size or any(type(c) is not int or c not in (0,1,2) for c in row) for row in board):
            raise TransferError('学习局面棋子格式无效。')
        result = {k:safe(v) for k,v in state.items() if k in STATE_FIELDS}
        result['size'] = size
        # In-progress teaching demos have a local-only backup. Do not migrate a
        # display-only demonstration as the playable state.
        if state.get('demo_active'):
            backup = state.get('_demo_backup')
            if not isinstance(backup,dict) or backup.get('demo_active'):
                raise TransferError('请先在本机退出演示再迁移档案。')
            return board_state(backup)
        return result

    clean = {'schema':2,'revision':value['revision'],'active_profile_id':value['active_profile_id'],'profiles':{},'matches':{}}
    for identity, profile in profiles.items():
        if not isinstance(identity,str) or not identity or not isinstance(profile,dict) or profile.get('id') != identity or not isinstance(profile.get('name'),str) or not 1 <= len(profile['name']) <= 80:
            raise TransferError('学习者身份格式无效。')
        for field in ('attempts','notes','helped_lesson_ids'):
            if not isinstance(profile.get(field,[]),list):
                raise TransferError('学习记录列表格式无效。')
        for field in ('attempts','notes'):
            if any(not isinstance(v,dict) for v in profile.get(field,[])):
                raise TransferError('学习记录条目格式无效。')
        runs = profile.get('lesson_runs',{})
        if not isinstance(runs,dict) or any(not isinstance(k,str) or type(v) is not int or v<0 for k,v in runs.items()):
            raise TransferError('练习次数格式无效。')
        result = {k:safe(v) for k,v in profile.items() if k in PROFILE_FIELDS and k not in ('state','lesson_runs')}
        result['state']=board_state(profile.get('state'))
        result['lesson_runs']=dict(runs)
        result.setdefault('attempts',[]);result.setdefault('notes',[]);result.setdefault('helped_lesson_ids',[])
        clean['profiles'][identity]=result
    matches=value.get('matches',{})
    if not isinstance(matches,dict):
        raise TransferError('对局档案格式无效。')
    for identity, match in matches.items():
        if not isinstance(identity,str) or not isinstance(match,dict) or match.get('id')!=identity:
            raise TransferError('对局身份格式无效。')
        result={k:safe(v) for k,v in match.items() if k in MATCH_FIELDS and k!='state'}
        result['state']=board_state(match.get('state'))
        clean['matches'][identity]=result
    if len(json.dumps(clean,ensure_ascii=False,allow_nan=False).encode()) > MAX_BYTES:
        raise TransferError('规范化档案超过 5 MiB。')
    return clean


def main(argv=None):
    parser=argparse.ArgumentParser(description='迁移围棋学习进度；默认仅校验、不联网。云端必须为空，服务端负责备份及拒绝覆盖。')
    parser.add_argument('--source',required=True,help='本机 schema=2 profiles.json')
    parser.add_argument('--url',default='https://go.huashan.app')
    parser.add_argument('--password-file')
    parser.add_argument('--lessons-file',help='可选：需一并迁移的已核对结构化题列表 JSON；不读取原图')
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--apply',action='store_true',help='登录并迁移到空云端档案')
    mode.add_argument('--dry-run',action='store_true',help='仅校验，不读取密码、不联网（默认）')
    args=parser.parse_args(argv)
    try:
        try:
            store=sanitize_store(read_json(args.source))
            lessons=None
            if args.lessons_file:
                raw=read_json(args.lessons_file)
                if not isinstance(raw,list) or len(raw)>1000:
                    raise TransferError('题目文件必须是最多 1000 道已核对题目的数组。')
                lessons=[validate_lesson(l) for l in raw]
        except (ValueError,RecursionError,TypeError):
            raise TransferError('本机档案或题目格式校验失败；未上传。') from None
        counts=dict(profiles=len(store['profiles']),matches=len(store['matches']),attempts=sum(len(p['attempts']) for p in store['profiles'].values()))
        print(f'校验通过：{counts["profiles"]} 位学习者、{counts["attempts"]} 次练习、{counts["matches"]} 盘对局。')
        if not args.apply:
            print('仅校验，未联网、未读取密码。添加 --apply 执行；原文件保持原位。')
            return 0
        client=Client(args.url,args.password_file)
        client.login()
        state=client.state()
        payload={'store':store,'revision':state['revision']}
        if isinstance(state.get('profile'),dict) and state['profile'].get('id'):
            payload['expected_profile_id']=state['profile']['id']
        if lessons is not None:payload['lessons']=lessons
        result=client.request('POST','/api/migrate',payload)
        if not isinstance(result,dict) or result.get('ok') is not True or type(result.get('revision')) is not int:
            raise TransferError('迁移响应未确认成功；请检查云进度，勿直接重试。')
        current=client.state()
        remote_ids={p.get('id') for p in current.get('profiles',[]) if isinstance(p,dict)}
        if current['revision'] < result['revision'] or not set(store['profiles']) <= remote_ids:
            raise TransferError('迁移请求已返回，但回读档案不一致；请检查云进度，勿直接重试。')
        print('迁移已完成并回读确认。原本机档案保持原位；未上传原图或 LLM 设置。')
        return 0
    except TransferError as exc:
        print(str(exc),file=sys.stderr)
        return 1


if __name__=='__main__':raise SystemExit(main())
