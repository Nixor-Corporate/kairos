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

try {
    $policy = $method === 'POST'
        ? signoff_save_policy($pdo, $courseId, (int)$user['user_id'], $input)
        : signoff_policy($pdo, $courseId);
    json_out($policy);
} catch (SignoffConflict $e) {
    json_out(['error' => 'policy_conflict', 'message' => $e->getMessage()], 409);
} catch (InvalidArgumentException $e) {
    json_out(['error' => 'invalid_policy', 'message' => $e->getMessage()], 422);
} catch (Throwable $e) {
    error_log('[kairos] sign-off policy failed: ' . get_class($e));
    json_out(['error' => 'server', 'message' => 'Could not load or save sign-off requirements.'], 500);
}