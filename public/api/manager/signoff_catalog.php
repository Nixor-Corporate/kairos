<?php
declare(strict_types=1);

require_once dirname(__DIR__, 3) . '/src/rbac.php';
require_once dirname(__DIR__, 3) . '/src/signoff.php';
require_once dirname(__DIR__, 3) . '/src/signoff_catalog_management.php';

$user = require_login();
$pdo = db();
header('Cache-Control: no-store');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'POST') {
    header('Allow: GET, POST');
    json_out(['error' => 'method_not_allowed'], 405);
}
$input = $method === 'POST' ? kairos_json_input() : $_GET;
try {
    $courseId = signoff_catalog_id($input['course_id'] ?? null);
    if (!rbac_can($pdo, $user, 'manage_course', $courseId)) {
        json_out(['error' => 'forbidden'], 403);
    }
    if ($method === 'GET') {
        json_out(signoff_manage_catalog($pdo, $courseId));
    }
    json_out(signoff_change_catalog($pdo, $courseId, (int)$user['user_id'], $input));
} catch (SignoffTaskNotFound $error) {
    json_out(['error' => 'item_not_found', 'message' => $error->getMessage()], 404);
} catch (SignoffConflict $error) {
    json_out(['error' => 'catalog_conflict', 'message' => $error->getMessage()], 409);
} catch (InvalidArgumentException $error) {
    json_out(['error' => 'invalid_catalog', 'message' => $error->getMessage()], 422);
} catch (Throwable $error) {
    error_log('[kairos] sign-off catalog failed: ' . get_class($error));
    json_out(['error' => 'server', 'message' => 'Could not load or save sign-off tasks.'], 500);
}
