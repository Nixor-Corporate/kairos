<?php
declare(strict_types=1);

require_once dirname(__DIR__, 3) . '/src/rbac.php';
require_once dirname(__DIR__, 3) . '/src/signoff.php';
require_once dirname(__DIR__) . '/_ws_notify.php';

[$pdo, $user] = require_ta_user();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST');
    json_out(['error' => 'method_not_allowed'], 405);
}
$input = kairos_json_input();
$idOptions = ['options' => ['min_range' => 1]];
$studentId = filter_var($input['user_id'] ?? null, FILTER_VALIDATE_INT, $idOptions);
$detailId = filter_var($input['detail_id'] ?? null, FILTER_VALIDATE_INT, $idOptions);
$status = $input['status'] ?? 'none';
$status = is_string($status) ? (strtolower(trim($status)) ?: 'none') : null;
if (!$studentId || !$detailId || !in_array($status, ['none', 'pending', 'completed', 'review'], true)) {
    json_out(['error' => 'invalid_progress', 'message' => 'Select a student, task and valid status.'], 400);
}

try {
    $stmt = $pdo->prepare(
        'SELECT c.course_id FROM progress_details d JOIN progress_category c ON c.category_id = d.category_id
         WHERE d.detail_id = ?'
    );
    $stmt->execute([$detailId]);
    $courseId = (int)$stmt->fetchColumn();
    if (!$courseId) {
        json_out(['error' => 'detail_not_found'], 404);
    }
    if (!rbac_can($pdo, $user, 'update_student_progress', $courseId)) {
        json_out(['error' => 'forbidden'], 403);
    }
    if (!in_array($courseId, rbac_student_course_ids($pdo, $studentId), true)) {
        json_out(['error' => 'student_not_found'], 404);
    }

    if (signoff_update_progress($pdo, $courseId, $studentId, $detailId, (int)$user['user_id'], $status, $input)) {
        safe_ws_notify([
            'event' => 'progress',
            'course_id' => $courseId,
            'ref_id' => $detailId,
            'payload' => ['user_id' => $studentId],
        ], 'sign-off notification failed');
    }
    json_out(['success' => true, 'status' => ucfirst($status)]);
} catch (SignoffConflict $e) {
    json_out(['error' => 'signoff_conflict', 'message' => $e->getMessage()], 409);
} catch (InvalidArgumentException $e) {
    json_out(['error' => 'invalid_signoff', 'message' => $e->getMessage()], 422);
} catch (Throwable $e) {
    error_log('[kairos] sign-off update failed: ' . get_class($e));
    json_out(['error' => 'server', 'message' => 'Could not update progress. Try again.'], 500);
}