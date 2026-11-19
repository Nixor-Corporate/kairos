<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once dirname(__DIR__, 2) . '/src/rbac.php';

$user = require_login();
$pdo = db();
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_out(['error' => 'method_not_allowed'], 405);
}

$courseId = filter_var($_GET['course_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if ($courseId === false) {
    json_out(['error' => 'invalid_course'], 400);
}
if (!rbac_can($pdo, $user, 'view_course', $courseId)) {
    json_out(['error' => 'forbidden'], 403);
}

try {
    $stmt = $pdo->prepare('SELECT category_id, name FROM progress_category WHERE course_id = ? AND archived_at IS NULL ORDER BY name');
    $stmt->execute([$courseId]);
    $categories = $stmt->fetchAll();
    $stmt = $pdo->prepare(
        'SELECT d.detail_id, d.category_id, d.name, ps.name AS status_name
         FROM progress_details d JOIN progress_category c ON c.category_id = d.category_id
         LEFT JOIN progress p ON p.detail_id = d.detail_id AND p.user_id = ?
         LEFT JOIN progress_status ps ON ps.progress_status_id = p.status_id
         WHERE c.course_id = ? AND c.archived_at IS NULL AND d.archived_at IS NULL ORDER BY d.name'
    );
    $stmt->execute([$user['user_id'], $courseId]);
    $details = [];
    $statuses = [];
    while ($row = $stmt->fetch()) {
        if ($row['status_name'] !== null) {
            $statuses[(int)$row['detail_id']] = $row['status_name'];
        }
        unset($row['status_name']);
        $details[$row['category_id']][] = $row;
    }
    json_out([
        'categories' => $categories,
        'detailsByCategory' => $details,
        'userStatuses' => (object)$statuses,
    ]);
} catch (Throwable $e) {
    error_log('[kairos] progress read failed: ' . get_class($e));
    json_out(['error' => 'server'], 500);
}
