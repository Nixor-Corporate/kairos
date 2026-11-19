<?php
declare(strict_types=1);

function signoff_task_catalog(PDO $pdo, int $courseId): array
{
    $stmt = $pdo->prepare(
        'SELECT d.detail_id, d.name, c.name AS category
         FROM progress_details d JOIN progress_category c USING (category_id)
         WHERE c.course_id = ? AND c.archived_at IS NULL AND d.archived_at IS NULL
         ORDER BY c.name, d.name, d.detail_id'
    );
    $stmt->execute([$courseId]);
    return $stmt->fetchAll();
}

function signoff_task_overrides(PDO $pdo, int $courseId, ?int $detailId = null): array
{
    $sql = 'SELECT h.detail_id, h.revision, h.configuration
            FROM signoff_task_policy_history h
            JOIN (SELECT detail_id, MAX(revision) AS revision FROM signoff_task_policy_history
                  WHERE course_id = ?' . ($detailId === null ? '' : ' AND detail_id = ?') . ' GROUP BY detail_id) latest
              ON latest.detail_id = h.detail_id AND latest.revision = h.revision
            JOIN progress_details d ON d.detail_id = h.detail_id
            JOIN progress_category c ON c.category_id = d.category_id AND c.course_id = h.course_id
            WHERE h.course_id = ? AND c.archived_at IS NULL AND d.archived_at IS NULL';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($detailId === null ? [$courseId, $courseId] : [$courseId, $detailId, $courseId]);
    $overrides = [];
    while ($row = $stmt->fetch()) {
        $overrides[(int)$row['detail_id']] = [
            'task_revision' => (int)$row['revision'],
            'overrides' => json_decode($row['configuration'], true, 512, JSON_THROW_ON_ERROR),
        ];
    }
    return $overrides;
}

function signoff_effective_policy(array $course, ?array $task): array
{
    $overrides = $task['overrides'] ?? [];
    $course['task_revision'] = $task['task_revision'] ?? 0;
    $course['rating_required'] = $overrides['rating_required'] ?? $course['rating_required'];
    $course['comment_required'] = $overrides['comment_required'] ?? $course['comment_required'];
    if (isset($overrides['options'])) {
        $course['options'] = array_map(
            static fn (int $index, string $label): array => [
                'id' => 'task:' . ($index + 1), 'label' => $label, 'active' => true,
            ],
            array_keys($overrides['options']),
            $overrides['options']
        );
    }
    return $course;
}

function signoff_require_rating_choices(array $policy): void
{
    foreach ($policy['options'] as $option) {
        if ($option['active']) {
            return;
        }
    }
    if ($policy['rating_required']) {
        throw new InvalidArgumentException('Add an active rating choice for tasks that require a rating.');
    }
}

function signoff_validate_task_overrides(array $input): array
{
    $result = [];
    foreach (['rating_required', 'comment_required'] as $key) {
        $value = $input[$key] ?? null;
        if ($value !== null && !is_bool($value)) {
            throw new InvalidArgumentException('Choose inherit, required, or optional.');
        }
        $result[$key] = $value;
    }
    $labels = $input['options'] ?? null;
    if ($labels !== null) {
        if (!is_array($labels) || !array_is_list($labels) || !$labels) {
            throw new InvalidArgumentException('Add at least one task rating choice or inherit the course choices.');
        }
        $validated = signoff_validate_policy([
            'revision' => 0, 'rating_required' => true, 'comment_required' => false,
            'options' => array_map(static fn ($label) => ['label' => $label, 'active' => true], $labels),
        ]);
        $labels = array_column($validated['options'], 'label');
    }
    $result['options'] = $labels;
    return $result;
}

function signoff_task_settings(PDO $pdo, int $courseId, int $detailId, ?array $course = null): array
{
    $stmt = $pdo->prepare(
        'SELECT 1 FROM progress_details d JOIN progress_category c USING (category_id)
         WHERE d.detail_id = ? AND c.course_id = ? AND c.archived_at IS NULL AND d.archived_at IS NULL'
    );
    $stmt->execute([$detailId, $courseId]);
    if (!$stmt->fetchColumn()) {
        throw new SignoffTaskNotFound('Task not found in this course.');
    }
    $course ??= signoff_policy($pdo, $courseId);
    $task = signoff_task_overrides($pdo, $courseId, $detailId)[$detailId]
        ?? ['task_revision' => 0, 'overrides' => signoff_validate_task_overrides([])];
    return [
        'revision' => $course['revision'],
        'task_revision' => $task['task_revision'],
        'overrides' => $task['overrides'],
        'defaults' => [
            'rating_required' => $course['rating_required'],
            'comment_required' => $course['comment_required'],
        ],
        'effective' => signoff_effective_policy($course, $task),
    ];
}

final class SignoffTaskNotFound extends RuntimeException
{
}

function signoff_save_task_settings(PDO $pdo, int $courseId, int $detailId, int $actorId, array $input): array
{
    foreach (['rating_required', 'comment_required', 'options'] as $key) {
        if (!array_key_exists($key, $input)) {
            throw new InvalidArgumentException('Submit all task settings. Use inherit to restore a course default.');
        }
    }
    $overrides = signoff_validate_task_overrides($input);
    $pdo->beginTransaction();
    try {
        $lock = $pdo->prepare('SELECT course_id FROM courses WHERE course_id = ? FOR UPDATE');
        $lock->execute([$courseId]);
        if (!$lock->fetchColumn()) {
            throw new SignoffTaskNotFound('Task not found in this course.');
        }

        $course = signoff_policy($pdo, $courseId);
        $settings = signoff_task_settings($pdo, $courseId, $detailId, $course);
        if (($input['revision'] ?? null) !== $settings['revision']
            || ($input['task_revision'] ?? null) !== $settings['task_revision']) {
            throw new SignoffConflict('The requirements changed. Reload them before saving again.');
        }
        if ($overrides !== $settings['overrides']) {
            $revision = $settings['task_revision'] + 1;
            signoff_require_rating_choices(signoff_effective_policy($course, ['overrides' => $overrides]));
            $stmt = $pdo->prepare(
                'INSERT INTO signoff_task_policy_history (course_id, detail_id, revision, actor_user_id, configuration)
                 VALUES (?, ?, ?, ?, ?)'
            );
            $stmt->execute([$courseId, $detailId, $revision, $actorId, json_encode($overrides, JSON_THROW_ON_ERROR)]);
            $settings = signoff_task_settings($pdo, $courseId, $detailId, $course);
        }
        $pdo->commit();
        return $settings;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}
