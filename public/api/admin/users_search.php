<?php
declare(strict_types=1);

require_once __DIR__ . '/../_helpers.php';
require_once __DIR__ . '/../manager/_helpers.php';

$user = require_login();
$pdo  = db();

require_role_or_higher($pdo, $user, 'admin');

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    json_out(['error' => 'method_not_allowed'], 405);
}

$courseId = (int)($_GET['course_id'] ?? 0);
$q        = trim((string)($_GET['q'] ?? ''));

if ($courseId <= 0) {
    json_out(['error' => 'invalid_course', 'message' => 'course_id required'], 400);
}

if (!rbac_course_exists($pdo, $courseId)) {
    json_out(['error' => 'course_not_found'], 404);
}

if ($q === '') {
    json_out([]);
}

$isEmail = filter_var($q, FILTER_VALIDATE_EMAIL) !== false;
if (!$isEmail && strlen($q) < 2) {
    json_out([]);
}

[$roster, $params] = course_student_roster_query($pdo, $courseId);
$sql = "SELECT CAST(u.user_id AS UNSIGNED) AS user_id, u.name, u.email
        FROM ($roster) e JOIN users u ON u.user_id = e.user_id WHERE";

if ($isEmail) {
    $sql .= ' LOWER(u.email) = LOWER(?)';
    $params[] = $q;
} else {
    $sql .= ' LOWER(u.name) LIKE ?';
    $params[] = '%' . strtolower($q) . '%';
}

$sql .= ' ORDER BY u.name LIMIT 25';

$st = $pdo->prepare($sql);
$st->execute($params);
$rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

$out = [];
foreach ($rows as $row) {
    $out[] = [
        'user_id' => isset($row['user_id']) ? (int)$row['user_id'] : null,
        'name'    => $row['name'] ?? '',
        'email'   => $row['email'] ?? '',
    ];
}

json_out($out);
