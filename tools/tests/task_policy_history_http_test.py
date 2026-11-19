"""Task policy and historical workbook smoke test against the synthetic loopback fixture."""
import io
import os
from zipfile import ZipFile
from openpyxl import load_workbook
from http.cookiejar import CookieJar
from urllib.request import build_opener, HTTPCookieProcessor, Request
from urllib.error import HTTPError
import json

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
        data = res.read()
        if 'json' in res.headers.get('Content-Type', ''):
            data = json.loads(data)
        assert res.code == expected, (endpoint,res.code,data)
        return data

def login(name):
    c = build_opener(HTTPCookieProcessor(CookieJar()))
    csrf = req(c,'auth/csrf.php')['data']['csrf_token']
    req(c,'auth/login_password.php',body={'identifier':name+'@example.test','password':os.environ['KAIROS_TEST_PASSWORD']},csrf=csrf)
    return c


ta, student, manager, admin = [login(name) for name in ['ta', 'student', 'manager', 'admin']]
policy_route = 'manager/signoff_policy.php'
progress_route = 'ta/update_progress.php'

def defaults():
    return req(manager, policy_route + '?course_id=111')

def task(detail_id):
    return req(manager, policy_route + f'?course_id=111&detail_id={detail_id}')

def configure(detail_id, *, rating=None, comment=None, options=None, expected=200, prior=None):
    config = prior if prior is not None else task(detail_id)
    return req(manager, policy_route, expected, {
        'course_id': 111, 'detail_id': detail_id, 'revision': config['revision'],
        'task_revision': config['task_revision'], 'rating_required': rating,
        'comment_required': comment, 'options': options,
    })

def complete(detail_id, settings, expected=200, **values):
    return req(ta, progress_route, expected, {
        'user_id': 101, 'detail_id': detail_id, 'status': 'completed',
        'policy_revision': settings['revision'], 'task_revision': settings['task_revision'], **values,
    })

req(student, policy_route + '?course_id=111', 403)
req(ta, policy_route, 403, {'course_id': 111, 'detail_id': 181})
req(manager, policy_route + '?course_id=111&detail_id=183', 404)
req(student, progress_route, 403, {'user_id': 101, 'detail_id': 181, 'status': 'completed'})

# Reset the synthetic task progress to exercise a new completion on repeated runs.
req(ta, progress_route, body={'user_id': 101, 'detail_id': 181, 'status': 'review'})
old = task(181)
custom = configure(181, rating=True, comment=True, options=['Revisit', 'Custom pass'])
assert custom['effective']['options'][1]['label'] == 'Custom pass'
if old['task_revision'] != custom['task_revision']:
    configure(181, options=['Stale'], expected=409, prior=old)
complete(181, custom, 422, comment='No selected rating')
complete(181, custom, 422, rating_option_id='task:2')
complete(181, custom, 409, task_revision=0, rating_option_id='task:2', comment='Old revision')
complete(181, custom, rating_option_id='task:2', comment='Synthetic retained comment')
complete(181, custom, rating_option_id='task:2', comment='Retry should preserve original')
course = defaults()
if not any(option['active'] for option in course['options']):
    course['options'].append({'label': 'Course pass', 'active': True})
    course = req(manager, policy_route, body={**course, 'course_id': 111})
configure(182, rating=True)
course = req(manager, policy_route, body={**course, 'course_id': 111, 'comment_required': True})
assert task(182)['effective']['comment_required']
assert task(181)['effective']['options'][1]['label'] == 'Custom pass'
inactive = [{**choice, 'active': False} for choice in course['options']]
req(manager, policy_route, 422, {**course, 'course_id': 111, 'rating_required': False, 'options': inactive})
reset = configure(181)
assert reset['effective']['comment_required'] and reset['effective']['options'] == course['options']
assert reset['task_revision'] > custom['task_revision']

catalog_route = 'manager/signoff_catalog.php'

def change(kind, action, expected=200, client=manager, **fields):
    return req(client, catalog_route, expected, {
        'course_id': 111, 'kind': kind, 'action': action, **fields,
    })

req(student, catalog_route + '?course_id=111', 403)
req(manager, catalog_route + '?course_id=112', 403)
change('category', 'create', 403, client=ta, name='TA cannot create')
change('category', 'create', 422, name='  ')
change('task', 'create', 404, category_id=122, name='Outside course')
change('task', 'archive', 404, category_id=121, detail_id=183, expected_name='Foreign Task')
category = change('category', 'create', name='Catalog QA')['category_id']
change('category', 'create', 409, name='Catalog QA')
change('category', 'rename', 409, category_id=category, name='Stale', expected_name='Older name')
change('category', 'rename', category_id=category, name='Catalog QA renamed', expected_name='Catalog QA')
individually_archived = change('task', 'create', category_id=category, name='Task to archive')['detail_id']
archived_by_category = change('task', 'create', category_id=category, name='Task under archive')['detail_id']
change('task', 'rename', category_id=category, detail_id=individually_archived,
       name='Renamed task', expected_name='Task to archive')
complete(individually_archived, task(individually_archived), comment='Catalog history retained')
student_progress = lambda: req(student, 'progress.php?course_id=111')
assert {int(row['detail_id']) for row in student_progress()['detailsByCategory'][str(category)]} == {
    individually_archived, archived_by_category,
}
change('task', 'archive', category_id=category, detail_id=individually_archived, expected_name='Renamed task')
assert [int(row['detail_id']) for row in student_progress()['detailsByCategory'][str(category)]] == [archived_by_category]
req(manager, policy_route + f'?course_id=111&detail_id={individually_archived}', 404)
change('category', 'archive', category_id=category, expected_name='Catalog QA renamed')
assert all(int(row['category_id']) != category for row in student_progress()['categories'])
assert all(int(row['category_id']) != category for row in
           req(ta, 'ta/student_progress.php?course_id=111&user_id=101')['categories'])
for archived in (individually_archived, archived_by_category):
    req(ta, progress_route, 409, {'user_id': 101, 'detail_id': archived, 'status': 'review'})
detail = req(manager, 'manager/progress.php?course_id=111&user_id=101')
assert detail['userStatuses'][str(individually_archived)] == 'Completed'
assert any(row['signoff_comment'] == 'Catalog history retained' for row in detail['signoffHistory'])

req(manager, 'manager/unenroll.php', body={'user_id': 109, 'course_id': 111})
route = 'manager/progress_export.php?course_id='
req(student, route + '111', 403)
req(ta, route + '111', 403)
req(manager, route + '112', 403)
data = req(manager, route + '111')
book = load_workbook(io.BytesIO(data), read_only=True)
assert len(book.sheetnames) == 14
assert any(row[3] == str(individually_archived) and row[4] == 'Renamed task' and row[5] and row[6]
           for row in book['Tasks'].values)
assert any(row[2] == str(individually_archived) and row[3] == 'Completed'
           for row in book['Task progress'].values)
enrollment = {row[3]: row for row in list(book['Enrollments'].values)[1:]}
assert len(enrollment) == len(list(book['Enrollments'].values)) - 1
assert {uid: enrollment[uid][5] for uid in ['101', '107', '108', '109']} == {
    '101': 'Current', '107': 'Former', '108': 'Indeterminate', '109': 'Former',
}
assert '103' not in enrollment
assert book['Enrollments'].cell(1 + list(enrollment).index('107') + 1, 5).data_type == 's'
assert any(row[0] == '213' for row in book['Submissions'].values)
assert any(row[0] == '280101' for row in book['Quiz attempts'].values)
assert all(row[0] != '280102' for row in book['Quiz attempts'].values)
assert any(row[0] == 'Conflicts excluded · Quiz attempts' and int(row[1]) >= 1 for row in book['About'].values)
assert any(row[2] == '107' and row[7] == 9.5 for row in book['Grades'].values)
history = [row for row in book['Sign-off history'].values if row[3] == '181' and row[7] == 'completed']
assert history[-1][10] == 'Custom pass' and history[-1][11] == 'Synthetic retained comment'
assert history[-1][13:] == (str(custom['task_revision']), '2')
with ZipFile(io.BytesIO(data)) as archive:
    assert all(b'private fixture value' not in archive.read(name) for name in archive.namelist())
print('Task catalog, task requirements and historical workbook passed for four roles.')
