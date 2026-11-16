<?php
declare(strict_types=1);

require_once dirname(__DIR__, 3) . '/src/rbac.php';
require_once dirname(__DIR__, 3) . '/src/signoff.php';

$user = require_login();
$pdo = db();
header('Cache-Control: no-store');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'POST') {
    header('Allow: GET, POST');
    json_out(['error' => 'method_not_allowed'], 405);
}
$input = $method === 'POST' ? kairos_json_input() : $_GET;
$courseId = filter_var($input['course_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if (!$courseId) {
    json_out(['error' => 'invalid_course'], 400);
}
if (!rbac_can($pdo, $user, 'manage_course', $courseId)) {
    json_out(['error' => 'forbidden'], 403);
}

$detailId = null;
if (array_key_exists('detail_id', $input)) {
    $detailId = filter_var($input['detail_id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$detailId) {
        json_out(['error' => 'invalid_task'], 400);
    }
}

try {
    if ($detailId !== null) {
        $policy = $method === 'POST'
            ? signoff_save_task_settings($pdo, $courseId, $detailId, (int)$user['user_id'], $input)
            : signoff_task_settings($pdo, $courseId, $detailId);
    } else {
        $policy = $method === 'POST'
            ? signoff_save_policy($pdo, $courseId, (int)$user['user_id'], $input)
            : signoff_policy($pdo, $courseId);
        if ($method === 'GET' && ($input['include_tasks'] ?? '') === '1') {
            $policy['tasks'] = signoff_task_catalog($pdo, $courseId);
        }
    }
    json_out($policy);
} catch (SignoffTaskNotFound $e) {
    json_out(['error' => 'task_not_found', 'message' => $e->getMessage()], 404);
} catch (SignoffConflict $e) {
    json_out(['error' => 'policy_conflict', 'message' => $e->getMessage()], 409);
} catch (InvalidArgumentException $e) {
    json_out(['error' => 'invalid_policy', 'message' => $e->getMessage()], 422);
} catch (Throwable $e) {
    error_log('[kairos] sign-off policy failed: ' . get_class($e));
    json_out(['error' => 'server', 'message' => 'Could not load or save sign-off requirements.'], 500);
}
