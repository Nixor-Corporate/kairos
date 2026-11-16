"""Regression checks against the disposable, loopback-only Kairos fixture."""

import json
import os
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

port = int(os.environ.get('KAIROS_TEST_PORT', '33317'))
base = f'http://127.0.0.1:{port}'


def req(client, endpoint, expected=200, body=None, csrf=None):
    headers = {'Origin': base}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    if csrf:
        headers['X-CSRF-Token'] = csrf
    req = Request(base+'/api/'+endpoint, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        res = client.open(req, timeout=10)
    except HTTPError as ex:
        res = ex
    with res:
        data = json.loads(res.read())
        assert res.code == expected, (endpoint,res.code,data)
        return data

def login(name):
    c = build_opener(HTTPCookieProcessor(CookieJar()))
    csrf = req(c,'auth/csrf.php')['data']['csrf_token']
    req(c,'auth/login_password.php',body={'identifier':name+'@example.test','password':os.environ['KAIROS_TEST_PASSWORD']},csrf=csrf)
    return c

ta,student,manager,admin = [login(name) for name in ['ta','student','manager','admin']]
assert req(student,'me.php')['user_id'] == 101
room = 'queues.php?room_id=141'
assert req(student,room)[0]['queue_id'] == 151
ta_state = lambda: req(ta,'ta/queues.php?room_id=141')['queues'][0]
current = ta_state()['serving']
if current:
    req(ta,'ta/stop.php',body={'queue_id':151,'assignment_id':current['ta_assignment_id']})
req(student,'queues.php',body={'queue_id':151,'action':'join'})
snap = req(student,'queue_participants.php?queue_id=151')
assert snap['position'] is not None
assert req(student,'queues.php',body={'queue_id':151,'action':'leave'})['left']
req(student,'queues.php',body={'queue_id':151,'action':'join'})
a = req(ta,'ta/accept.php',body={'queue_id':151,'user_id':101})['assignment_id']
assert req(student,room)[0]['serving']['ta_assignment_id'] == a
assert req(student,'queues.php',409,{'queue_id':151,'action':'leave'})['error'] == 'already_serving'
req(student,'queues.php',409,{'queue_id':151,'action':'join'})
req(ta,'ta/stop.php',body={'queue_id':151,'assignment_id':a})
req(student,'queues.php',body={'queue_id':151,'action':'join'})
b = req(ta,'ta/accept.php',body={'queue_id':151,'user_id':101})['assignment_id']
assert b != a
assert req(ta,'ta/stop.php',409,{'queue_id':151,'assignment_id':a})['error'] == 'serving_changed'
assert ta_state()['serving']['ta_assignment_id'] == b
req(ta,'ta/stop.php',body={'queue_id':151,'assignment_id':b})
assert ta_state()['serving'] is None
assert req(ta,'ta/stop.php',body={'queue_id':151,'assignment_id':b})['already']
roster = lambda: {r['user_id'] for r in req(manager,'manager/users_search.php?course_id=111&roster=1')}
assert roster() == {101,102}
req(manager,'manager/unenroll.php',body={'course_id':111,'user_id':105})
assert roster() == {101,102}, 'unenrollment preserves a manager grant in the same enrollment table'
assert req(manager,'manager/users_search.php?course_id=111&q=learner%40example.test') == []
assert req(admin,'admin/users_search.php?course_id=111&q=learner%40example.test')[0]['user_id'] == 102
req(ta,'ta/comment.php',body={'user_id':102,'course_id':111,'text':'Synthetic legacy enrollment check'})
req(manager,'manager/unenroll.php',body={'course_id':111,'user_id':102})
assert roster() == {101}
assert req(manager,'manager/users_search.php?course_id=111&q=learner%40example.test')[0]['user_id'] == 102
req(manager,'manager/enroll.php',body={'course_id':111,'user_id':102})
assert roster() == {101,102}
req(manager,'manager/unenroll.php',body={'course_id':111,'user_id':104})
assert req(ta,'ta/queues.php?room_id=141')['queues'], 'student roster removal preserved the staff assignment'
req(manager,'manager/users_search.php?course_id=112&roster=1',403)
assert req(student,'me.php')['user_id'] == 101
print('HTTP passed: queue snapshots, waiting leave, stale stop protection, repeat stop, multi-source roster and enrollment, staff role retained, authorized course scope and session reuse.')
