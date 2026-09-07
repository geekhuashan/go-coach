#!/usr/bin/env python3
"""Authenticated loopback bridge for a Cloudflare Tunnel to local KataGo."""
import argparse
import hmac
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import engine


def validate_state(state):
    if not isinstance(state, dict) or type(state.get('size')) is not int or state['size'] not in (9, 19):
        raise ValueError('Unsupported board size')
    size = state['size']
    for field in ('board', 'initial_board'):
        board = state.get(field, state.get('board'))
        if not isinstance(board, list) or len(board) != size or any(
            not isinstance(row, list) or len(row) != size or any(type(c) is not int or c not in (0, 1, 2) for c in row)
            for row in board
        ):
            raise ValueError('Invalid board')
    if state.get('to_play') not in (1, 2) or type(state.get('revision')) is not int:
        raise ValueError('Invalid state')
    moves = state.get('moves', [])
    if not isinstance(moves, list) or len(moves) > 2000:
        raise ValueError('Invalid moves')
    for move in moves:
        if not isinstance(move, dict) or move.get('color') not in (1, 2):
            raise ValueError('Invalid move')
        if not move.get('pass'):
            engine.coordinate(move.get('x'), move.get('y'), size)
    return state


def handler(token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never log bearer tokens, board content, or private requests.

        def reply(self, code, body):
            encoded = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self):
            if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                return self.reply(401, {'error': 'Unauthorized'})
            if self.path != '/health':
                return self.reply(404, {'error': 'Not found'})
            available = engine.info()['available']
            return self.reply(200 if available else 503, {'ok': available, 'available': available})

        def do_POST(self):
            if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                return self.reply(401, {'error': 'Unauthorized'})
            if self.path not in ('/analyze', '/move', '/review'):
                return self.reply(404, {'error': 'Not found'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 262144:
                    return self.reply(413, {'error': 'Invalid request size'})
                self.connection.settimeout(10)
                payload = json.loads(self.rfile.read(length))
                state = validate_state(payload.get('state'))
                if self.path == '/review': engine.review_points(state)
            except (ValueError, TypeError, AttributeError, OSError):
                return self.reply(400, {'error': 'Invalid request'})
            try:
                operation={'/analyze':engine.analyze,'/move':engine.choose_move,'/review':engine.review}[self.path]
                self.reply(200, operation(state))
            except Exception:
                self.reply(503, {'error': 'Local engine temporarily unavailable'})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--token-file', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8770)
    args = parser.parse_args()
    token = args.token_file.read_text().strip()
    if len(token) < 32:
        parser.error('Token must contain at least 32 characters')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(token))
    print(f'KataGo bridge listening on loopback port {args.port}', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        engine.close()


if __name__ == '__main__':
    main()
