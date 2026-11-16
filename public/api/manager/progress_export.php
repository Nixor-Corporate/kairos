<?php
declare(strict_types=1);

require_once dirname(__DIR__, 3) . '/src/rbac.php';
require_once dirname(__DIR__, 3) . '/src/progress_export.php';

$user = require_login();
$pdo = db();
header('Cache-Control: private, no-store, max-age=0');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_out(['error' => 'method_not_allowed'], 405);
}
$courseId = filter_var($_GET['course_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if (!$courseId) {
    json_out(['error' => 'invalid_course'], 400);
}
if (!rbac_can($pdo, $user, 'manage_course', $courseId)) {
    json_out(['error' => 'forbidden'], 403);
}
if (!class_exists(ZipArchive::class) || !class_exists(XMLWriter::class)) {
    json_out(['error' => 'export_unavailable', 'message' => 'Excel export is unavailable. Contact Kairos support.'], 503);
}
session_write_close();

$file = tempnam(sys_get_temp_dir(), 'kairos-export-');
if ($file === false) {
    json_out(['error' => 'export_unavailable', 'message' => 'Could not prepare the export. Try again.'], 503);
}
register_shutdown_function(static function () use ($file): void {
    if (is_file($file)) {
        unlink($file);
    }
});

try {
    $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    $pdo->beginTransaction();
    $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
    export_progress_workbook($pdo, $courseId, $file);
    $pdo->commit();
    $size = filesize($file);
    if ($size === false || $size === 0) {
        throw new RuntimeException('Empty workbook');
    }
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('[kairos] progress export failed: ' . get_class($e));
    $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);
    json_out(['error' => 'export_failed', 'message' => 'Could not prepare the Excel export. Try again.'], 500);
}
$pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);

header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
header('Content-Disposition: attachment; filename="kairos-course-' . $courseId . '-progress.xlsx"');
header('Content-Length: ' . $size);
readfile($file);
