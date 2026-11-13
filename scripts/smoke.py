#!/usr/bin/env python3
"""HTTP acceptance test against a running API and real MySQL; removes its own card."""
import json
import os
import time
import urllib.error
import urllib.request

BASE = os.environ.get('API_URL', 'http://127.0.0.1:8080')

def call(method, path, body=None, expected=200):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read()
    assert status == expected, (method, path, status, raw.decode())
    return json.loads(raw) if raw else None

board = call('GET', '/api/board')
assert [c['name'] for c in board['columns'][:3]] == ['Todo', 'Doing', 'Done']
assert sum(c['title'] == 'ドラッグ＆ドロップでカードの移動・並べ替えを実装する'
           for c in board['cards']) == 1
name = 'Review'
column = next((c for c in board['columns'] if c['name'] == name), None)
if column is None:
    column = call('POST', '/api/columns', {'name': name}, 201)
call('POST', '/api/columns', {'name': name}, 409)
card = call('POST', '/api/cards', {'title': '  動作確認 🧪  ',
            'description': '実際のMySQLでCRUDを確認', 'columnId': 1}, 201)
path = f"/api/cards/{card['id']}"
try:
    assert isinstance(card['number'], int) and card['number'] > 0
    assert call('GET', f"/api/cards/by-number/{card['number']}")['id'] == card['id']
    assert card['title'] == '動作確認 🧪'
    pr_url = 'https://github.com/poteto317/scrum-board/pull/2'
    linked = call('PATCH', path, {'prUrl': '  ' + pr_url + '  '})
    assert linked['prUrl'] == pr_url
    assert next(c for c in call('GET', '/api/board')['cards'] if c['id'] == card['id'])['prUrl'] == pr_url
    call('PATCH', path, {'prUrl': 'https://github.com.evil/a/b/pull/1', 'title': 'must not change'}, 400)
    assert call('GET', path) == linked
    history_path = f"/api/cards/by-number/{card['number']}/history"
    events = call('GET', history_path)['events']
    assert any(e['kind'] == 'created' for e in events)
    assert any(any(c['field'] == 'prUrl' and c['after'] == pr_url for c in e['changes']) for e in events)
    status_path = f"/api/cards/by-number/{card['number']}/status"
    doing = next(c for c in board['columns'] if c['name'] == 'Doing')
    by_name = call('PATCH', status_path, {'status': 'Doing'})
    assert by_name['id'] == card['id'] and by_name['columnId'] == doing['id']
    assert by_name['number'] == card['number'] and by_name['description'] == card['description']
    by_name = call('PATCH', status_path, {'status': column['name']})
    assert by_name['columnId'] == column['id']
    repeated = call('PATCH', status_path, {'status': column['name']})
    assert repeated['prUrl'] == pr_url
    assert repeated['number'] == card['number'] and repeated['columnId'] == column['id']
    history_before = call('GET', history_path)
    repeated = call('PATCH', status_path, {'status': column['name']})
    assert call('GET', history_path) == history_before
    call('PATCH', status_path, {'status': 'not-an-existing-status'}, 400)
    assert call('GET', path) == repeated
    moved = call('PATCH', path, {'columnId': column['id']})
    assert moved['title'] == card['title'] and moved['description'] == card['description']
    assert moved['columnId'] == column['id']
    assert moved['number'] == card['number']
    assert call('GET', path)['number'] == card['number']
    call('PATCH', path, {'columnId': 999999}, 400)
    assert call('GET', path)['columnId'] == column['id']
    call('PATCH', path, {'title': '　 '}, 400)
    call('PATCH', path, {'description': 'あ' * 10001}, 400)
    call('POST', '/api/cards', {'columnId': 1, 'title': 'あ' * 201}, 400)
    call('POST', '/api/columns', {'name': ' '}, 400)
    unchanged = call('PATCH', path, {'columnId': column['id']})
    assert unchanged['columnId'] == column['id']
    assert call('PATCH', path, {'prUrl': ''})['prUrl'] == ''
    print('PASS: PR link save/preserve/clear/invalid input; real MySQL CRUD, Unicode, partial update, status, duplicates, validation')
finally:
    call('DELETE', path, expected=204)
call('GET', history_path, expected=404)
call('GET', path, expected=404)
call('PATCH', status_path, {'status': 'Done'}, expected=404)
call('GET', f"/api/cards/by-number/{card['number']}", expected=404)
print('PASS: deletion and 404; sample appears exactly once')
