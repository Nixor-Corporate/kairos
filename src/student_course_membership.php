<?php
declare(strict_types=1);

require_once __DIR__ . '/rbac.php';

function student_course_grant_mappings(PDO $pdo): array
{
    $mappings = [];
    foreach (rbac_student_course_mappings() as $map) {
        $columns = [$map['user_col'], $map['course_col']];
        if ($map['role_col'] !== null) {
            $columns[] = $map['role_col'];
        }
        if (rbac_table_has_columns($pdo, $map['table'], $columns)) {
            $mappings[] = array_map(
                static fn (?string $value): ?string => $value === null ? null : rbac_quote_identifier($value),
                $map
            );
        }
    }
    if (!$mappings) {
        throw new RuntimeException('No supported enrollment mapping');
    }
    return $mappings;
}

function student_course_role_condition(?string $role): string
{
    return $role === null ? '' : " AND ($role IS NULL OR LOWER($role) = 'student')";
}

function course_student_roster_query(PDO $pdo, int $courseId): array
{
    $queries = [];
    foreach (student_course_grant_mappings($pdo) as $map) {
        $query = "SELECT DISTINCT {$map['user_col']} AS user_id FROM {$map['table']} WHERE {$map['course_col']} = ?";
        $queries[] = $query . student_course_role_condition($map['role_col']);
    }
    return [implode(' UNION ', $queries), array_fill(0, count($queries), $courseId)];
}

function remove_student_course_grants(PDO $pdo, int $userId, int $courseId): bool
{
    $mappings = student_course_grant_mappings($pdo);
    $pdo->beginTransaction();
    try {
        $removed = false;
        foreach ($mappings as $map) {
            $sql = "DELETE FROM {$map['table']} WHERE {$map['user_col']} = ? AND {$map['course_col']} = ?";
            $stmt = $pdo->prepare($sql . student_course_role_condition($map['role_col']));
            $stmt->execute([$userId, $courseId]);
            $removed = $stmt->rowCount() > 0 || $removed;
        }
        if ($removed) {
            $record = $pdo->prepare(
                'INSERT INTO course_student_withdrawals (course_id, user_id) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE withdrawn_at = CURRENT_TIMESTAMP'
            );
            $record->execute([$courseId, $userId]);
        }
        $pdo->commit();
        return $removed;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}
