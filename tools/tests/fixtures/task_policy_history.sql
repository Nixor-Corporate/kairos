-- Seed a disposable database after tools/tests/fixtures/queue_enrollment.sql.
-- Requires LMS core and both sign-off and withdrawal migrations.
INSERT INTO users (user_id, google_id, email, name, role_id, account_status) VALUES
  (103, 'fixture-103', 'unrelated@example.test', 'Unrelated Student', (SELECT role_id FROM roles WHERE name='student'), 'active'),
  (107, 'fixture-107', 'archive@example.test', '=Former & <Example>', (SELECT role_id FROM roles WHERE name='student'), 'active'),
  (108, 'fixture-108', 'uncertain@example.test', 'Fixture Indeterminate', (SELECT role_id FROM roles WHERE name='student'), 'active'),
  (109, 'fixture-109', 'withdrawn@example.test', 'Fixture Withdrawn', (SELECT role_id FROM roles WHERE name='student'), 'active');

INSERT INTO student_courses (user_id,course_id) VALUES (103,112),(109,111);
INSERT INTO progress_category (category_id,course_id,name) VALUES (121,111,'Labs'),(122,112,'Foreign Tasks');
INSERT INTO progress_details (detail_id,category_id,name) VALUES (181,121,'Override A'),(182,121,'Override B'),(183,122,'Foreign Task');
INSERT INTO progress (user_id,detail_id,status_id)
SELECT 107,181,progress_status_id FROM progress_status WHERE name='Completed';
INSERT INTO ta_assignments (ta_user_id,student_user_id,queue_id,started_at,ended_at,completed_at,finished_at)
VALUES (104,108,151,NOW(),NOW(),NOW(),NOW());
INSERT INTO lms_assignments (assignment_id,course_id,title,status,deleted_at)
VALUES (203,111,'Archived fixture assignment','archived',NOW());
INSERT INTO lms_submissions (submission_id,assignment_id,course_id,student_user_id) VALUES (213,203,111,107);
INSERT INTO lms_grades (course_id,student_user_id,assignment_id,submission_id,score,max_score,graded_by,staff_private_note)
VALUES (111,107,203,213,9.5,10,104,'private fixture value');
INSERT INTO lms_assessments (assessment_id,course_id,title) VALUES (181,111,'Local quiz'),(182,112,'Other quiz');
INSERT INTO lms_assessment_attempts (attempt_id,assessment_id,course_id,user_id,score,max_score)
VALUES (280101,181,111,107,9,10),(280102,182,111,107,1,10);
