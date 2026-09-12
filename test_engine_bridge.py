"""HTTP boundary checks for the loopback bridge; no KataGo process or saved data."""
import copy
import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import engine_bridge


class EngineBridgeHTTPTest(unittest.TestCase):
    token = 'test-only-bridge-token-not-a-real-secret-12345'

    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), engine_bridge.handler(cls.token))
        cls.worker = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.worker.join(timeout=2)

    def setUp(self):
        self.analyze_patch = patch.object(engine_bridge.engine, 'analyze', return_value={'moves': []})
        self.move_patch = patch.object(engine_bridge.engine, 'choose_move', return_value={'x': 0, 'y': 0})
        self.analyze = self.analyze_patch.start()
        self.move = self.move_patch.start()
        self.review_patch = patch.object(engine_bridge.engine,'review',return_value={'revision':1,'engine':'KataGo','perspective':'black','candidate':{},'reference':{}})
        self.review = self.review_patch.start()
        self.addCleanup(self.review_patch.stop)
        self.addCleanup(self.analyze_patch.stop)
        self.addCleanup(self.move_patch.stop)

    @staticmethod
    def state(size=9):
        board = [[0] * size for _ in range(size)]
        return {'size': size, 'board': board, 'initial_board': copy.deepcopy(board),
                'to_play': 1, 'revision': 1, 'moves': []}

    def request(self, route='/analyze', payload=None, *, raw=None, auth=True, headers=None, method='POST'):
        body = raw if raw is not None else json.dumps(payload if payload is not None else {'state': self.state()}).encode()
        request_headers = {'Content-Type': 'application/json'}
        if auth:
            request_headers['Authorization'] = 'Bearer ' + self.token
        request_headers.update(headers or {})
        connection = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=3)
        try:
            connection.request(method, route, body=None if method == 'GET' else body, headers=request_headers)
            response = connection.getresponse()
            data = response.read()
            self.assertEqual(response.getheader('Cache-Control'), 'no-store')
            self.assertTrue(response.getheader('Content-Type').startswith('application/json'))
            self.assertEqual(int(response.getheader('Content-Length')), len(data))
            return response.status, json.loads(data)
        finally:
            connection.close()

    def test_health_is_authenticated_and_does_not_start_engine(self):
        self.assertEqual(self.request('/health', method='GET', auth=False)[0], 401)
        with patch.object(engine_bridge.engine, 'info', return_value={'available': True, 'busy': False}):
            self.assertEqual(self.request('/health', method='GET'),
                             (200, {'ok': True, 'available': True, 'busy': False}))
        with patch.object(engine_bridge.engine, 'info', return_value={'available': True, 'busy': True}):
            self.assertEqual(self.request('/health', method='GET'),
                             (200, {'ok': True, 'available': True, 'busy': True}))
        with patch.object(engine_bridge.engine, 'info', return_value={'available': False, 'busy': False}):
            self.assertEqual(self.request('/health', method='GET')[0], 503)
        self.assertEqual(self.request('/other', method='GET')[0], 404)
        self.analyze.assert_not_called()
        self.move.assert_not_called()

    def test_auth_required_before_parsing_body(self):
        for headers in ({}, {'Authorization': 'Bearer wrong'}, {'Authorization': self.token}):
            with self.subTest(headers=list(headers)):
                code, result = self.request(raw=b'not-json', auth=False, headers=headers)
                self.assertEqual((code, result), (401, {'error': 'Unauthorized'}))
        self.analyze.assert_not_called()
        self.move.assert_not_called()

    def test_unknown_route_does_not_call_engine(self):
        self.assertEqual(self.request('/other')[0], 404)
        self.analyze.assert_not_called()
        self.move.assert_not_called()

    def test_valid_sizes_and_corner_coordinates_reach_correct_engine(self):
        for size, corner in ((9, 'J1'), (19, 'T1')):
            for route, mock in (('/analyze', self.analyze), ('/move', self.move)):
                with self.subTest(size=size, route=route):
                    state = self.state(size)
                    state['moves'] = [{'color': 1, 'x': size - 1, 'y': size - 1}, {'color': 2, 'pass': True}]
                    self.assertEqual(engine_bridge.engine.coordinate(size - 1, size - 1, size), corner)
                    code, result = self.request(route, {'state': state})
                    self.assertEqual(code, 200)
                    self.assertEqual(result, mock.return_value)
                    mock.assert_called_with(state)

    def test_invalid_coordinate_does_not_reach_engine(self):
        for size in (9, 19):
            for x, y in ((-1, 0), (size, 0), (0, size), (0, None), (True, 0)):
                with self.subTest(size=size, x=x, y=y):
                    state = self.state(size)
                    state['moves'] = [{'color': 1, 'x': x, 'y': y}]
                    self.assertEqual(self.request(payload={'state': state})[0], 400)
        self.analyze.assert_not_called()

    def test_malformed_payloads_and_board_rejected(self):
        bad_states = [None, {}, self.state() | {'size': 13}, self.state() | {'size': True},
                      self.state() | {'board': [[0]]}, self.state() | {'initial_board': []},
                      self.state() | {'revision': '1'}, self.state() | {'moves': [{}]},
                      self.state() | {'moves': [None] * 2001}]
        bad_cell = self.state()
        bad_cell['board'][0][0] = True
        bad_states.append(bad_cell)
        for state in bad_states:
            with self.subTest(state_type=type(state).__name__):
                self.assertEqual(self.request(payload={'state': state})[0], 400)
        for raw in (b'null', b'[]', b'"text"', b'{', b'\xff'):
            with self.subTest(raw=repr(raw)):
                self.assertEqual(self.request(raw=raw)[0], 400)
        self.analyze.assert_not_called()

    def test_request_size_limit_checked_before_reading_body(self):
        for length in ('0', '-1', '262145'):
            with self.subTest(length=length):
                self.assertEqual(self.request(raw=b'{}', headers={'Content-Length': length})[0], 413)
        self.assertEqual(self.request(raw=b'{}', headers={'Content-Length': 'invalid'})[0], 400)
        self.analyze.assert_not_called()

    def test_review_auth_validation_and_dispatch(self):
        self.assertEqual(self.request('/review',auth=False,raw=b'not-json')[0],401)
        self.review.assert_not_called()
        for size in (9,19):
            state=self.state(size)
            state['review']={'candidate':{'x':0,'y':0},'reference':{'x':size-1,'y':size-1}}
            self.assertEqual(self.request('/review',{'state':state}), (200,self.review.return_value))
            self.review.assert_called_with(state)
        self.analyze.assert_not_called();self.move.assert_not_called()
        self.review.reset_mock()
        for review in (None,{}, {'candidate':{'x':0,'y':0},'reference':{'x':19,'y':0}},
                       {'candidate':{'x':0,'y':0},'reference':{'x':1,'y':1},'third':{'x':2,'y':2}}):
            state=self.state();state['review']=review
            self.assertEqual(self.request('/review',{'state':state})[0],400)
        self.review.assert_not_called()
        state=self.state();state['review']={'candidate':{'x':0,'y':0},'reference':{'x':1,'y':1}}
        self.review.side_effect=RuntimeError('private-engine-detail')
        self.assertEqual(self.request('/review',{'state':state}), (503,{'error':'Local engine temporarily unavailable'}))

    def test_engine_exception_returns_generic_503_without_details(self):
        private_detail = 'private-config-path-and-engine-token-must-not-appear'
        for route, mock in (('/analyze', self.analyze), ('/move', self.move)):
            with self.subTest(route=route):
                mock.side_effect = RuntimeError(private_detail)
                code, result = self.request(route)
                self.assertEqual(code, 503)
                self.assertEqual(result, {'error': 'Local engine temporarily unavailable'})
                self.assertNotIn(private_detail, json.dumps(result))
                self.assertNotIn(self.token, json.dumps(result))


if __name__ == '__main__':
    unittest.main()
