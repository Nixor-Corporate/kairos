<?php
declare(strict_types=1);

function signoff_manage_catalog(PDO $pdo, int $courseId): array
{
    $stmt = $pdo->prepare(
        'SELECT category_id, name FROM progress_category
         WHERE course_id = ? AND archived_at IS NULL ORDER BY name, category_id'
    );
    $stmt->execute([$courseId]);
    $categories = $stmt->fetchAll();
    $stmt = $pdo->prepare(
        'SELECT d.detail_id, d.category_id, d.name
         FROM progress_details d JOIN progress_category c USING (category_id)
         WHERE c.course_id = ? AND c.archived_at IS NULL AND d.archived_at IS NULL
         ORDER BY d.name, d.detail_id'
    );
    $stmt->execute([$courseId]);
    return ['categories' => $categories, 'tasks' => $stmt->fetchAll()];
}

function signoff_catalog_id(mixed $value): int
{
    $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$id || is_bool($value)) {
        throw new InvalidArgumentException('Select a category or task from this course.');
    }
    return $id;
}

function signoff_change_catalog(PDO $pdo, int $courseId, int $actorId, array $input): array
{
    $action = $input['action'] ?? '';
    $kind = $input['kind'] ?? '';
    if (!in_array($action, ['create', 'rename', 'archive'], true) || !in_array($kind, ['category', 'task'], true)) {
        throw new InvalidArgumentException('Choose a catalog action.');
    }
    $isTask = $kind === 'task';
    $categoryId = $isTask || $action !== 'create' ? signoff_catalog_id($input['category_id'] ?? null) : null;
    $detailId = $isTask && $action !== 'create' ? signoff_catalog_id($input['detail_id'] ?? null) : null;
    $name = $input['name'] ?? '';
    if ($action !== 'archive') {
        $name = is_string($name) ? preg_replace('/^[\s\p{Z}]+|[\s\p{Z}]+$/u', '', $name) : null;
        if (!is_string($name) || preg_match('/^[^\p{C}]{1,255}$/uD', $name) !== 1) {
            throw new InvalidArgumentException('Enter a name of 1 to 255 characters without control characters.');
        }
    }

    $pdo->beginTransaction();
    try {
        $lock = $pdo->prepare('SELECT course_id FROM courses WHERE course_id = ? FOR UPDATE');
        $lock->execute([$courseId]);
        if (!$lock->fetchColumn()) {
            throw new SignoffTaskNotFound('Course not found.');
        }

        $previousName = null;
        if ($categoryId !== null) {
            $stmt = $pdo->prepare('SELECT name FROM progress_category WHERE course_id = ? AND category_id = ? AND archived_at IS NULL');
            $stmt->execute([$courseId, $categoryId]);
            $categoryName = $stmt->fetchColumn();
            if ($categoryName === false) {
                throw new SignoffTaskNotFound('Active category not found in this course.');
            }
            if (!$isTask) {
                $previousName = $categoryName;
            }
        }
        if ($detailId !== null) {
            $stmt = $pdo->prepare('SELECT name FROM progress_details WHERE category_id = ? AND detail_id = ? AND archived_at IS NULL');
            $stmt->execute([$categoryId, $detailId]);
            $previousName = $stmt->fetchColumn();
            if ($previousName === false) {
                throw new SignoffTaskNotFound('Active task not found in this category.');
            }
        }

        if ($action !== 'create' && ($input['expected_name'] ?? null) !== $previousName) {
            throw new SignoffConflict('This name changed. Reload the list and try again.');
        }
        $table = $isTask ? 'progress_details' : 'progress_category';
        $parentColumn = $isTask ? 'category_id' : 'course_id';
        $parentId = $isTask ? $categoryId : $courseId;
        $idColumn = $isTask ? 'detail_id' : 'category_id';
        $id = $isTask ? $detailId : $categoryId;
        if ($action === 'rename' && $name === $previousName) {
            $pdo->commit();
            return ['category_id' => $categoryId, 'detail_id' => $detailId];
        }
        if ($action === 'archive') {
            $stmt = $pdo->prepare("UPDATE $table SET archived_at = UTC_TIMESTAMP() WHERE $idColumn = ? AND $parentColumn = ?");
            $stmt->execute([$id, $parentId]);
            $name = $previousName;
        } else {
            $stmt = $pdo->prepare(
                "SELECT 1 FROM $table WHERE $parentColumn = ? AND name = ? AND $idColumn <> ? AND archived_at IS NULL LIMIT 1"
            );
            $stmt->execute([$parentId, $name, $id ?? 0]);
            if ($stmt->fetchColumn()) {
                throw new SignoffConflict('An active item with that name already exists here.');
            }
            if ($action === 'create') {
                $stmt = $pdo->prepare("INSERT INTO $table ($parentColumn, name) VALUES (?, ?)");
                $stmt->execute([$parentId, $name]);
                if ($isTask) {
                    $detailId = (int)$pdo->lastInsertId();
                } else {
                    $categoryId = (int)$pdo->lastInsertId();
                }
            } else {
                $stmt = $pdo->prepare("UPDATE $table SET name = ? WHERE $idColumn = ? AND $parentColumn = ?");
                $stmt->execute([$name, $id, $parentId]);
            }
        }
        $audit = $pdo->prepare(
            'INSERT INTO signoff_catalog_history (course_id, category_id, detail_id, actor_user_id, action, previous_name, name)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $audit->execute([$courseId, $categoryId, $detailId, $actorId, $action, $previousName, $name]);
        $pdo->commit();
        return ['category_id' => $categoryId, 'detail_id' => $detailId];
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}
