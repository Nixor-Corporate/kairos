-- Use only with a fresh, disposable loopback database after baseline and auth migrations.
-- Set @fixture_password_hash in this same connection to an Argon2id hash for the test password.
INSERT INTO users (user_id, google_id, email, name, role_id, account_status, password_hash) VALUES
    (101, 'fixture-student', 'student@example.test', 'Fixture Student', (SELECT role_id FROM roles WHERE name = 'student'), 'active', @fixture_password_hash),
    (102, 'fixture-learner', 'learner@example.test', 'Legacy Learner', (SELECT role_id FROM roles WHERE name = 'student'), 'active', @fixture_password_hash),
    (104, 'fixture-ta', 'ta@example.test', 'Fixture TA', (SELECT role_id FROM roles WHERE name = 'ta'), 'active', @fixture_password_hash),
    (105, 'fixture-manager', 'manager@example.test', 'Fixture Manager', (SELECT role_id FROM roles WHERE name = 'manager'), 'active', @fixture_password_hash),
    (106, 'fixture-admin', 'admin@example.test', 'Fixture Admin', (SELECT role_id FROM roles WHERE name = 'admin'), 'active', @fixture_password_hash);

INSERT INTO courses (course_id, name, code, visibility) VALUES
    (111, 'Queue fixture course', 'QA-QUEUE', 'restricted'),
    (112, 'Unassigned fixture course', 'QA-OTHER', 'restricted');

INSERT INTO student_courses (user_id, course_id) VALUES (101, 111);
INSERT INTO enrollments (user_id, course_id, role) VALUES (101, 111, 'student'), (102, 111, NULL), (104, 111, 'ta'), (105, 111, 'manager');
INSERT INTO ta_courses (ta_user_id, course_id) VALUES (104, 111);
INSERT INTO rooms (room_id, course_id, name) VALUES (141, 111, 'Fixture room');
INSERT INTO queues (queue_id, room_id, name) VALUES (151, 141, 'Fixture queue');
