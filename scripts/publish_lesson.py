#!/usr/bin/env python3
"""Publish a locally reviewed structured Go lesson; never uploads source photos."""
import argparse
import http.cookiejar
import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPCookieProcessor, HTTPRedirectHandler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tactics import validate_lesson

MAX_BYTES = 5 * 1024 * 1024


class TransferError(Exception):
    """Safe, local diagnostics; never contains remote response bodies or secrets."""


def read_json(filename):
    try:
        with Path(filename).open('rb') as stream:
            raw = stream.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise TransferError('JSON 文件超过 5 MiB。')
        return json.loads(raw)
    except (OSError, ValueError, UnicodeError):
        raise TransferError('无法读取有效的 UTF-8 JSON 文件。') from None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise TransferError('服务器要求跳转；已停止，未向跳转地址转发凭据。')


class Client:
    def __init__(self, url, password_file):
        parts = urlsplit(url)
        if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment or parts.path not in ('', '/'):
            raise TransferError('URL 必须是无路径、凭据和查询参数的站点地址。')
        if parts.scheme != 'https' and parts.hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise TransferError('远程服务必须使用 HTTPS；仅本机测试允许 HTTP。')
        self.url = url.rstrip('/')
        self.password_file = password_file
        self.opener = build_opener(NoRedirect(), HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method, route, payload=None):
        data = None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
        if data is not None and len(data) > MAX_BYTES:
            raise TransferError('请求超过 5 MiB。')
        request = Request(self.url + route, data=data, method=method,
                          headers={'Content-Type': 'application/json', 'Origin': self.url, 'Accept': 'application/json', 'User-Agent': 'Go-Coach-CLI/1.0'})
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise TransferError('服务器响应过大。')
            return json.loads(raw)
        except HTTPError as exc:
            raise TransferError(f'服务请求失败（HTTP {exc.code}）；未显示服务器原始响应。') from None
        except (URLError, OSError, ValueError, UnicodeError):
            raise TransferError('无法完成请求或解析服务响应；未显示敏感响应内容。') from None

    def login(self):
        if not self.password_file:
            raise TransferError('上传需要 --password-file 指定本机密码文件。')
        try:
            with Path(self.password_file).open('r', encoding='utf-8') as stream:
                password = stream.read(4097).rstrip('\r\n')
        except (OSError, UnicodeError):
            raise TransferError('无法读取密码文件。') from None
        if not password or len(password) > 4096:
            raise TransferError('密码文件内容为空或过长。')
        self.request('POST', '/api/login', {'password': password})

    def state(self):
        value = self.request('GET', '/api/state')
        if not isinstance(value, dict) or type(value.get('revision')) is not int or value['revision'] < 0:
            raise TransferError('服务未返回有效 revision。')
        return value


def main(argv=None):
    parser = argparse.ArgumentParser(description='上传已核对的结构化围棋题；原图留在本机。默认仅校验，不联网。')
    parser.add_argument('--file', required=True, help='结构化题目 JSON 文件')
    parser.add_argument('--url', default='https://go.huashan.app')
    parser.add_argument('--password-file', help='本机家庭登录密码文件，不会打印或上传文件本身')
    parser.add_argument('--reviewed', action='store_true', help='确认已人工核对棋盘/先行方/答案变化，执行上传')
    parser.add_argument('--dry-run', action='store_true', help='只校验，优先于 --reviewed，不读取密码、不联网')
    args = parser.parse_args(argv)
    try:
        try:
            lesson = validate_lesson(read_json(args.file))
        except (ValueError, RecursionError):
            raise TransferError('题目校验未通过：请核对尺寸、棋子、先行方和答案树；未上传。') from None
        if args.dry_run or not args.reviewed:
            print(f'校验通过：{lesson["id"]}，{lesson["size"]} 路。仅保留规范结构化字段；未联网、未上传。')
            if not args.reviewed:
                print('人工核对照片及答案后，添加 --reviewed 和 --password-file 才会上传。')
            return 0
        client = Client(args.url, args.password_file)
        client.login()
        state = client.state()
        payload = {'lesson': lesson, 'revision': state['revision']}
        if isinstance(state.get('profile'), dict) and state['profile'].get('id'):
            payload['expected_profile_id'] = state['profile']['id']
        client.request('POST', '/api/lessons/import', payload)
        catalog = client.request('GET', '/api/lessons')
        entries = catalog.get('lessons', []) if isinstance(catalog, dict) else catalog
        if not isinstance(entries, list) or not any(isinstance(item, dict) and item.get('id') == lesson['id'] for item in entries):
            raise TransferError('上传请求已返回，但回读未找到题目；请检查云题库后再决定是否重试。')
        print(f'已上传并回读确认：{lesson["id"]}。原图和本机题库保持原位。')
        return 0
    except TransferError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
