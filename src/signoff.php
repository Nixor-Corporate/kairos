<?php
declare(strict_types=1);

require_once __DIR__ . '/task_signoff_policy.php';

final class SignoffConflict extends RuntimeException
{
}

function signoff_policy(PDO $pdo, int $courseId): array
{
    $stmt = $pdo->prepare(
        'SELECT p.rating_required, p.comment_required, p.revision, o.option_id, o.label, o.is_active
         FROM signoff_policies p LEFT JOIN signoff_rating_options o ON o.course_id = p.course_id
         WHERE p.course_id = ? ORDER BY o.sort_order, o.option_id'
    );
    $stmt->execute([$courseId]);
    $policy = ['revision' => 0, 'rating_required' => false, 'comment_required' => false, 'options' => []];
    while ($row = $stmt->fetch()) {
        $policy['revision'] = (int)$row['revision'];
        $policy['rating_required'] = (bool)$row['rating_required'];
        $policy['comment_required'] = (bool)$row['comment_required'];
        if ($row['option_id'] !== null) {
            $policy['options'][] = [
                'id' => (string)$row['option_id'],
                'label' => $row['label'],
                'active' => (bool)$row['is_active'],
            ];
        }
    }
    return $policy;
}

function signoff_validate_policy(array $input): array
{
    $options = $input['options'] ?? null;
    if (!is_array($options) || !array_is_list($options) || count($options) > 50
        || !is_int($input['revision'] ?? null) || $input['revision'] < 0
        || !is_bool($input['rating_required'] ?? null) || !is_bool($input['comment_required'] ?? null)) {
        throw new InvalidArgumentException('Enter valid sign-off requirements and up to 50 rating choices.');
    }
    $ids = [];
    $activeLabels = [];
    foreach ($options as &$option) {
        $label = is_string($option['label'] ?? null) ? trim($option['label']) : '';
        $id = $option['id'] ?? null;
        if (!is_bool($option['active'] ?? null) || preg_match('/^[^\p{C}]{1,120}$/uD', $label) !== 1
            || ($id !== null && (!is_string($id) || !ctype_digit($id) || isset($ids[$id])))) {
            throw new InvalidArgumentException('Give each choice a label of 1 to 120 characters.');
        }
        if ($id !== null) {
            $ids[$id] = true;
        }
        $key = strtolower($label);
        if ($option['active'] && isset($activeLabels[$key])) {
            throw new InvalidArgumentException('Active rating choices must have distinct labels.');
        }
        if ($option['active']) {
            $activeLabels[$key] = true;
        }
        $option = ['id' => $id, 'label' => $label, 'active' => $option['active']];
    }
    unset($option);
    if ($input['rating_required'] && !$activeLabels) {
        throw new InvalidArgumentException('Add an active rating choice before requiring a rating.');
    }
    return [
        'revision' => $input['revision'],
        'rating_required' => $input['rating_required'],
        'comment_required' => $input['comment_required'],
        'options' => $options,
    ];
}

function signoff_save_policy(PDO $pdo, int $courseId, int $actorId, array $input): array
{
    $input = signoff_validate_policy($input);
    $pdo->beginTransaction();
    try {
        $lock = $pdo->prepare('SELECT course_id FROM courses WHERE course_id = ? FOR UPDATE');
        $lock->execute([$courseId]);
        if (!$lock->fetchColumn()) {
            throw new SignoffConflict('This course is no longer available.');
        }
        $current = signoff_policy($pdo, $courseId);
        if ($input['revision'] !== $current['revision']) {
            throw new SignoffConflict('The requirements changed. Reload them before saving again.');
        }
        if ($input === $current) {
            $pdo->commit();
            return $current;
        }
        if (!array_filter($input['options'], static fn (array $option): bool => $option['active'])) {
            foreach (signoff_task_overrides($pdo, $courseId) as $task) {
                signoff_require_rating_choices(signoff_effective_policy($input, $task));
            }
        }
        $input['revision']++;
        $stmt = $pdo->prepare(
            'INSERT INTO signoff_policies (course_id, rating_required, comment_required, revision) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE rating_required = VALUES(rating_required),
             comment_required = VALUES(comment_required), revision = VALUES(revision)'
        );
        $stmt->execute([$courseId, (int)$input['rating_required'], (int)$input['comment_required'], $input['revision']]);

        $keep = array_column($current['options'], null, 'id');
        $insert = $pdo->prepare(
            'INSERT INTO signoff_rating_options (course_id, label, sort_order, is_active) VALUES (?, ?, ?, ?)'
        );
        $update = $pdo->prepare(
            'UPDATE signoff_rating_options SET label = ?, sort_order = ?, is_active = ? WHERE course_id = ? AND option_id = ?'
        );
        foreach ($input['options'] as $order => $option) {
            $id = $option['id'];
            if ($id === null) {
                $insert->execute([$courseId, $option['label'], $order, (int)$option['active']]);
            } elseif (isset($keep[$id])) {
                $update->execute([$option['label'], $order, (int)$option['active'], $courseId, $id]);
                unset($keep[$id]);
            } else {
                throw new InvalidArgumentException('Choose an existing rating option from this course.');
            }
        }
        if ($keep) {
            throw new InvalidArgumentException('Deactivate choices to retire them.');
        }
        $saved = signoff_policy($pdo, $courseId);
        $audit = $pdo->prepare(
            'INSERT INTO signoff_policy_history (course_id, revision, actor_user_id, configuration) VALUES (?, ?, ?, ?)'
        );
        $audit->execute([$courseId, $saved['revision'], $actorId, json_encode($saved, JSON_THROW_ON_ERROR)]);
        $pdo->commit();
        return $saved;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

function signoff_validate_completion(array $input, array $policy): array
{
    if ((isset($input['policy_revision']) && $input['policy_revision'] !== $policy['revision'])
        || ($input['task_revision'] ?? 0) !== ($policy['task_revision'] ?? 0)) {
        throw new SignoffConflict('Sign-off requirements changed. Reload the student and try again.');
    }
    $ratingId = $input['rating_option_id'] ?? null;
    $label = null;
    if ($ratingId !== null) {
        foreach ($policy['options'] as $option) {
            if ($option['id'] === $ratingId && $option['active']) {
                $label = $option['label'];
                break;
            }
        }
        if ($label === null || !isset($input['policy_revision'])) {
            throw new InvalidArgumentException('Choose a current rating option.');
        }
    } elseif ($policy['rating_required']) {
        throw new InvalidArgumentException('Select a rating to complete this task.');
    }

    $comment = $input['comment'] ?? '';
    if (!is_string($comment) || preg_match('/^.{0,2000}$/usD', $comment) !== 1) {
        throw new InvalidArgumentException('Enter a comment of up to 2,000 characters.');
    }
    $comment = preg_replace('/^[\s\p{Z}]+|[\s\p{Z}]+$/u', '', $comment);
    if ($policy['comment_required'] && preg_match('/[^\s\p{C}\p{Z}]/u', $comment) !== 1) {
        throw new InvalidArgumentException('Enter a comment to complete this task.');
    }
    return [$ratingId, $label, $comment === '' ? null : $comment];
}

function signoff_update_progress(
    PDO $pdo, int $courseId, int $studentId, int $detailId, int $actorId, string $status, array $input
): bool {
    $pdo->beginTransaction();
    try {
        // A shared course lock keeps the policy stable while independent students can be signed off in parallel.
        $courseLock = $pdo->prepare('SELECT course_id FROM courses WHERE course_id = ? LOCK IN SHARE MODE');
        $courseLock->execute([$courseId]);
        $studentLock = $pdo->prepare('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE');
        $studentLock->execute([$studentId]);
        if (!$courseLock->fetchColumn() || !$studentLock->fetchColumn()) {
            throw new SignoffConflict('This student or course is no longer available.');
        }
        $task = $pdo->prepare(
            'SELECT 1 FROM progress_details d JOIN progress_category c USING (category_id)
             WHERE c.course_id = ? AND d.detail_id = ? AND c.archived_at IS NULL AND d.archived_at IS NULL'
        );
        $task->execute([$courseId, $detailId]);
        if (!$task->fetchColumn()) {
            throw new SignoffConflict('This task is no longer active. Reload the student and try again.');
        }
        $stmt = $pdo->prepare(
            "SELECT COALESCE(LOWER(s.name), 'none') FROM progress p
             JOIN progress_status s ON s.progress_status_id = p.status_id WHERE p.user_id = ? AND p.detail_id = ?"
        );
        $stmt->execute([$studentId, $detailId]);
        $previous = $stmt->fetchColumn() ?: 'none';
        // Retrying a completed request is idempotent and cannot replace an existing rating or comment.
        if ($previous === $status) {
            $pdo->commit();
            return false;
        }
        if (isset($input['expected_status']) && $input['expected_status'] !== $previous) {
            throw new SignoffConflict('This task changed. Reload the student and try again.');
        }
        $policy = signoff_effective_policy(
            signoff_policy($pdo, $courseId),
            signoff_task_overrides($pdo, $courseId, $detailId)[$detailId] ?? null
        );
        [$ratingId, $label, $comment] = $status === 'completed'
            ? signoff_validate_completion($input, $policy)
            : [null, null, null];

        if ($status === 'none') {
            $stmt = $pdo->prepare('DELETE FROM progress WHERE user_id = ? AND detail_id = ?');
            $stmt->execute([$studentId, $detailId]);
        } else {
            $stmt = $pdo->prepare('SELECT progress_status_id FROM progress_status WHERE LOWER(name) = ?');
            $stmt->execute([$status]);
            $statusId = $stmt->fetchColumn();
            if (!$statusId) {
                throw new RuntimeException('Missing progress status');
            }
            $stmt = $pdo->prepare(
                'INSERT INTO progress (user_id, detail_id, status_id, created_at, updated_at)
                 VALUES (?, ?, ?, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE status_id = VALUES(status_id), updated_at = VALUES(updated_at)'
            );
            $stmt->execute([$studentId, $detailId, $statusId]);
        }
        $stmt = $pdo->prepare(
            'INSERT INTO signoff_history (course_id, student_user_id, detail_id, actor_user_id, previous_status, status,
                                          policy_revision, rating_option_id, rating_label, signoff_comment)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $position = $ratingId !== null && str_starts_with($ratingId, 'task:') ? (int)substr($ratingId, 5) : null;
        $stmt->execute([
            $courseId, $studentId, $detailId, $actorId, $previous, $status, $policy['revision'],
            $position === null ? $ratingId : null, $label, $comment,
        ]);
        if ($policy['task_revision'] > 0) {
            $eventId = $pdo->lastInsertId();
            $stmt = $pdo->prepare(
                'INSERT INTO signoff_task_event_policies (signoff_event_id, task_revision, rating_position) VALUES (?, ?, ?)'
            );
            $stmt->execute([$eventId, $policy['task_revision'], $position]);
        }
        log_change($pdo, 'progress', $detailId, $courseId);
        $pdo->commit();
        return true;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}
