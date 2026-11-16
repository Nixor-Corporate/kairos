"""PHP-issued leases and relay access checks on a disposable loopback fixture."""

import hashlib
import json
import os
import socket
import sys
from contextlib import closing
from http.cookiejar import CookieJar
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
assert os.environ.get('DB_HOST') == '127.0.0.1'
assert os.environ.get('DB_DATABASE') == 'kairos_realtime_test'
os.environ['LMS_OUTBOX_ENABLED'] = '0'

import ws_server as relay
from ws_emit import send_event


origin = f"http://127.0.0.1:{int(os.environ.get('KAIROS_TEST_PORT', '33317'))}"
headers = {'Origin': origin}
broker_headers = {'X-Kairos-WS-Secret': relay.WS_SHARED_SECRET}
broker = relay.app.test_client()


def php(client, endpoint, body=None, csrf=None, expected=200):
    req_headers = {**headers, 'Content-Type': 'application/json'}
    if csrf:
        req_headers['X-CSRF-Token'] = csrf
    data = None if body is None else json.dumps(body).encode()
    req = Request(f'{origin}/api/{endpoint}', data=data, headers=req_headers)
    try:
        response = client.open(req, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        assert response.code == expected, (endpoint, response.code)
        result = json.loads(response.read())
        if endpoint == 'me.php':
            assert 'no-store' in response.headers['Cache-Control']
        return result


def login(name):
    client = build_opener(HTTPCookieProcessor(CookieJar()))
    csrf = php(client, 'auth/csrf.php')['data']['csrf_token']
    php(client, 'auth/login_password.php', {
        'identifier': f'{name}@example.test', 'password': os.environ['KAIROS_TEST_PASSWORD'],
    }, csrf)
    return client


def token(client):
    return php(client, 'me.php')['ws']['token']


def connect(lease, scope='course_id=111&room_id=141', allowed_origin=origin, allowed=True):
    request_headers = {'Origin': allowed_origin} if allowed_origin else {}
    client = relay.socketio.test_client(relay.app, auth={'token': lease}, query_string=scope, headers=request_headers)
    assert client.is_connected() == allowed, (scope, allowed)
    return client


def emit(event='queue', course_id=111, room_id=141, payload=None, expected=200,
         supplied_headers=broker_headers, peer='127.0.0.1'):
    resp = broker.post('/emit', json={'event': event, 'course_id': course_id, 'room_id': room_id,
                                     'payload': payload or {}}, headers=supplied_headers,
                       environ_overrides={'REMOTE_ADDR': peer})
    assert resp.status_code == expected, (event, resp.status_code)
    return resp.json['sent'] if expected == 200 else None


def events(client):
    return [entry['name'] for entry in client.get_received()]


def change(sql, args=()):
    with closing(relay._open_db()) as db, db.cursor() as cursor:
        cursor.execute(sql, args)


def check_network_relay(port, lease):
    from wsproto import ConnectionType, WSConnection
    from wsproto.events import AcceptConnection, Request as Upgrade, TextMessage

    connection = WSConnection(ConnectionType.CLIENT)
    with socket.create_connection(('127.0.0.1', port), timeout=5) as peer:
        peer.sendall(connection.send(Upgrade(
            host=f'127.0.0.1:{port}', target='/websocket/socket.io/?EIO=4&transport=websocket&course_id=111',
            extra_headers=[(b'origin', origin.encode())],
        )))
        upgraded = False
        while chunk := peer.recv(65536):
            connection.receive_data(chunk)
            for event in connection.events():
                if isinstance(event, AcceptConnection):
                    upgraded = True
                if isinstance(event, TextMessage):
                    if event.data.startswith('0'):
                        assert upgraded
                        peer.sendall(connection.send(TextMessage(data='40' + json.dumps({'token': lease}))))
                    elif event.data.startswith('40'):
                        assert send_event(f'http://127.0.0.1:{port}/emit', relay.WS_SHARED_SECRET,
                                          {'event': 'rooms', 'course_id': 111}) == 200
                    elif event.data.startswith('42'):
                        assert json.loads(event.data[2:])[0] == 'rooms'
                        return
        raise AssertionError('no authenticated relay event received over the socket')


def main():
    student = login('student')
    keep_session = login('student')
    learner = login('learner')
    staff = login('ta')
    student_lease, keep_lease, legacy_lease, staff_lease = map(token, (student, keep_session, learner, staff))
    assert keep_lease != student_lease == token(student)
    assert len(student_lease) == 64
    present = connect(student_lease)
    legacy = connect(legacy_lease)
    classroom = connect(staff_lease, 'room_id=141&channels=queue,projector,progress,lms_grade')
    inbox = connect(student_lease, '')
    other_context = connect(staff_lease, 'course_id=111')
    connect(student_lease, 'course_id=112', allowed=False)
    connect(student_lease, 'course_id=112&room_id=141', allowed=False)
    connect(student_lease, 'room_id=missing', allowed=False)
    connect(student_lease, 'room_id=141&channels=projector', allowed=False)
    connect(student_lease, allowed_origin='https://unrelated.example.test', allowed=False)
    connect(student_lease, allowed_origin=None, allowed=False)
    assert not relay.socketio.test_client(relay.app, query_string='token=' + student_lease, headers=headers).is_connected()

    assert emit(expected=403, supplied_headers={}) is None
    assert emit(expected=403, peer='192.0.2.12') is None
    assert emit(expected=403, supplied_headers={**broker_headers, **headers}) is None
    emit(course_id=None, room_id=None, expected=400)
    assert emit(course_id=112) == 0
    assert emit() == 3
    assert all(events(client) == ['queue'] for client in (present, legacy, classroom))
    assert events(inbox) == events(other_context) == []

    assert emit('ta_accept', payload={'student_user_id': 101}) == 2
    assert events(present) == events(inbox) == ['ta_accept']
    assert events(legacy) == events(classroom) == []
    assert emit('projector_serve') == 1
    assert events(classroom) == ['projector_serve'] and events(legacy) == []
    lms_peer = connect(legacy_lease, 'course_id=111&channels=lms_grade')
    lms_owner = connect(student_lease, 'course_id=111&channels=lms_grade')
    assert relay._emit_authorized({'course_id': 111, 'event_name': 'quiz.attempt.graded', 'actor_id': 101}, lms=True) == 2
    assert events(lms_owner) == events(classroom) == ['quiz.attempt.graded'] and not events(lms_peer)
    assert relay._emit_authorized({'course_id': 111, 'event_name': 'grade.released', 'student_user_id': 101}, lms=True) == 2
    assert events(lms_owner) == events(classroom) == ['grade.released'] and not events(lms_peer)
    assert relay._emit_authorized({'course_id': 111, 'event_name': 'announcement.created',
                                   'audience': 'course_staff', 'status': 'draft'}, lms=True) == 1
    assert events(classroom) == ['announcement.created'] and not events(lms_owner) and not events(lms_peer)

    change('DELETE FROM enrollments WHERE user_id=102 AND course_id=111')
    try:
        assert emit() == 2
        assert not legacy.is_connected()
        connect(legacy_lease, allowed=False)
        assert relay._emit_authorized({'course_id': 111, 'event_name': 'assignment.updated'}, lms=True) == 2
        assert not lms_peer.is_connected()
    finally:
        change('INSERT INTO enrollments (user_id, course_id, role) VALUES (102,111,NULL)')

    change('DELETE FROM ta_courses WHERE ta_user_id=104 AND course_id=111')
    try:
        assert emit('projector_serve') == 0 and not classroom.is_connected()
        connect(staff_lease, allowed=False)
    finally:
        change('INSERT INTO ta_courses (ta_user_id, course_id) VALUES (104,111)')

    classroom = connect(staff_lease, 'room_id=141&channels=projector')
    change('UPDATE users SET is_active=0 WHERE user_id=104')
    try:
        assert emit('projector_serve') == 0 and not classroom.is_connected()
        connect(staff_lease, allowed=False)
    finally:
        change('UPDATE users SET is_active=1 WHERE user_id=104')

    change('UPDATE users SET auth_session_version=auth_session_version+1 WHERE user_id=104')
    emit('progress', room_id=None, payload={'user_id': 101})
    assert not other_context.is_connected()
    connect(staff_lease, '', allowed=False)
    php(staff, 'me.php', expected=401)

    with patch.object(relay, '_open_db', side_effect=RuntimeError):
        connect(student_lease, allowed=False)
        emit(expected=500)
    assert 'queue' not in events(inbox)

    php(student, 'logout.php', {})
    emit('ta_accept', payload={'student_user_id': 101})
    assert not present.is_connected() and not inbox.is_connected()
    connect(student_lease, '', allowed=False)
    kept = connect(keep_lease)
    change('UPDATE realtime_session_leases SET expires_at=UTC_TIMESTAMP() WHERE token_hash=UNHEX(%s)',
           (hashlib.sha256(keep_lease.encode()).hexdigest(),))
    assert emit() == 0 and not kept.is_connected()
    connect(keep_lease, '', allowed=False)
    fresh_lease = token(keep_session)
    assert fresh_lease != keep_lease
    connect(keep_lease, '', allowed=False)

    if port := os.environ.get('KAIROS_TEST_RELAY_PORT'):
        check_network_relay(int(port), fresh_lease)

    class LocalBroker(BaseHTTPRequestHandler):
        attempts = 0

        def log_message(self, *_args):
            pass

        def do_POST(self):
            type(self).attempts += 1
            assert self.headers['X-Kairos-WS-Secret'] == relay.WS_SHARED_SECRET
            self.send_response(307)
            self.send_header('Location', '/redirected')
            self.end_headers()

    with HTTPServer(('127.0.0.1', 0), LocalBroker) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f'http://127.0.0.1:{server.server_port}/emit'
            try:
                send_event(url, relay.WS_SHARED_SECRET, {})
            except HTTPError as error:
                assert error.code == 307
            else:
                raise AssertionError('unexpected redirected success')
            with patch('urllib.request.build_opener') as opener:
                try:
                    send_event('https://unrelated.example.test/emit', relay.WS_SHARED_SECRET, {})
                except ValueError:
                    opener.assert_not_called()
                else:
                    raise AssertionError('non-loopback emitter target was accepted')
        finally:
            server.shutdown()
            thread.join()
    assert LocalBroker.attempts == 1
    print('PHP leases, live relay access, audience and origin isolation, revocation, expiry and broker checks passed.')


if __name__ == '__main__':
    main()
