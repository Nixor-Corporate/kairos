<?php
declare(strict_types=1);

require_once __DIR__ . '/_helpers.php';

$user = require_login();
$pdo  = db();
require_role_or_higher($pdo, $user, 'manager');
$userId = isset($user['user_id']) ? (int)$user['user_id'] : 0;
if ($userId <= 0) {
    json_out(['error' => 'forbidden', 'message' => 'missing user id'], 403);
}

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_out(['error' => 'method_not_allowed'], 405);
}

if (
    !table_exists($pdo, 'users') ||
    !table_has_columns($pdo, 'users', ['user_id', 'name', 'email', 'role_id']) ||
    !table_exists($pdo, 'roles') ||
    !table_has_columns($pdo, 'roles', ['role_id', 'name'])
) {
    json_out(['error' => 'unsupported', 'message' => 'users table not available'], 500);
}

$courseId = isset($_GET['course_id']) ? (int)$_GET['course_id'] : 0;
$q        = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
$roster   = !empty($_GET['roster']);

if ($courseId > 0) {
    assert_manager_controls_course($pdo, $userId, $courseId);
}

if ($roster && $courseId > 0) {
    $rows = users_for_course($pdo, $courseId);
    $out = [];
    foreach ($rows as $row) {
        $out[] = [
            'user_id'  => isset($row['user_id']) ? (int)$row['user_id'] : null,
            'name'     => $row['name'],
            'email'    => $row['email'],
            'enrolled' => true,
        ];
    }
    json_out($out);
}

if ($q === '') {
    json_out([]);
}

$isEmail        = filter_var($q, FILTER_VALIDATE_EMAIL) !== false;
$params = [];
$enrollmentJoin = '';
$enrollmentWhere = '';
$limit = 25;
if ($courseId > 0) {
    [$roster, $params] = course_student_roster_query($pdo, $courseId);
    $enrollmentJoin = " LEFT JOIN ($roster) e ON e.user_id = u.user_id";
    $enrollmentWhere = ' AND e.user_id IS NULL';
}

if ($isEmail) {
    $sql          = 'SELECT u.user_id, u.name, u.email
                     FROM users u'
                    . $enrollmentJoin .
                    ' WHERE LOWER(u.email) = LOWER(?)'
                    . $enrollmentWhere .
                    ' LIMIT ' . (int)$limit;
    $params[] = $q;
} else {
    if (strlen($q) < 2) {
        json_out([]);
    }

    $term            = '%' . strtolower($q) . '%';
    $sql             = 'SELECT u.user_id, u.name, u.email
                        FROM users u'
                        . $enrollmentJoin .
                        ' WHERE LOWER(u.name) LIKE ?'
                        . $enrollmentWhere .
                        ' ORDER BY u.name
                        LIMIT ' . (int)$limit;
    $params[] = $term;
}

$st = $pdo->prepare($sql);
$st->execute($params);
$rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

$out = [];
foreach ($rows as $row) {
    $uid = isset($row['user_id']) ? (int)$row['user_id'] : 0;
    $out[] = [
        'user_id'  => $uid,
        'name'     => $row['name'] ?? '',
        'email'    => $row['email'] ?? '',
        'enrolled' => $courseId > 0 ? false : null,
    ];
}

json_out($out);
