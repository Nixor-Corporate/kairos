<?php
declare(strict_types=1);

require_once __DIR__ . '/student_course_membership.php';

/** Each evidence source produces the verified student identifier and strongest supported status. */
function export_student_evidence(PDO $pdo, int $courseId): array
{
    $sources = [];
    foreach (student_course_grant_mappings($pdo) as $map) {
        $table = trim($map['table'], '`');
        $withdrawn = [];
        $unconfirmed = [];
        foreach (['status', 'enrollment_status'] as $column) {
            if (rbac_table_has_columns($pdo, $table, [$column])) {
                $status = 'LOWER(TRIM(' . rbac_quote_identifier($column) . '))';
                $withdrawn[] = "$status IN ('withdrawn', 'unenrolled', 'revoked', 'removed')";
                $unconfirmed[] = "$status NOT IN ('active', 'enrolled', 'joined')";
            }
        }
        if (rbac_table_has_columns($pdo, $table, ['is_active'])) {
            $unconfirmed[] = 'is_active = 0';
        }
        $rank = 'CASE WHEN ' . implode(' OR ', [...$withdrawn, 'FALSE']) . ' THEN 2 WHEN '
            . implode(' OR ', [...$unconfirmed, 'FALSE']) . ' THEN 1 ELSE 3 END';
        $sources[] = "SELECT DISTINCT {$map['user_col']} AS user_id, $rank AS evidence FROM {$map['table']}
                      WHERE {$map['course_col']} = ?" . student_course_role_condition($map['role_col']);
    }

    $sources[] = 'SELECT user_id, 2 FROM course_student_withdrawals WHERE course_id = ?';
    $sources[] = 'SELECT DISTINCT p.user_id, 2 FROM progress p JOIN progress_details d USING (detail_id)
                  JOIN progress_category c USING (category_id) WHERE c.course_id = ?';
    $sources[] = 'SELECT DISTINCT student_user_id, 2 FROM signoff_history WHERE course_id = ?';
    $sources[] = 'SELECT DISTINCT p.user_id, 2 FROM lms_lesson_completions p
                  JOIN lms_lessons l ON l.lesson_id = p.lesson_id AND l.course_id = p.course_id
                  JOIN lms_course_sections s ON s.section_id = l.section_id AND s.course_id = p.course_id
                  WHERE p.course_id = ?';
    $sources[] = 'SELECT DISTINCT t.user_id, 2 FROM lms_assessment_attempts t
                  JOIN lms_assessments a ON a.assessment_id = t.assessment_id AND a.course_id = t.course_id
                  WHERE t.course_id = ?';
    $sources[] = 'SELECT DISTINCT s.student_user_id, 2 FROM lms_submissions s
                  JOIN lms_assignments a ON a.assignment_id = s.assignment_id AND a.course_id = s.course_id
                  WHERE s.course_id = ?';
    $sources[] = 'SELECT DISTINCT g.student_user_id, 2 ' . export_grade_scope();
    $sources[] = 'SELECT DISTINCT a.student_user_id, 1 FROM ta_assignments a
                  JOIN queues q USING (queue_id) JOIN rooms r USING (room_id) WHERE r.course_id = ?';
    if (rbac_table_has_columns($pdo, 'course_pre_enroll', ['course_id', 'claimed_user_id'])) {
        $sources[] = 'SELECT DISTINCT claimed_user_id, 2 FROM course_pre_enroll
                      WHERE course_id = ? AND claimed_user_id > 0';
    }

    $evidence = implode(' UNION ALL ', $sources);
    return [
        "SELECT user_id, MAX(evidence) AS evidence FROM ($evidence) records GROUP BY user_id",
        array_fill(0, count($sources), $courseId),
    ];
}

/** The grade row owns a course even when a retained parent was deleted. Conflicting links are quarantined. */
function export_grade_scope(bool $conflicts = false): string
{
    return 'FROM lms_grades g
            LEFT JOIN lms_assignments a ON a.assignment_id = g.assignment_id
            LEFT JOIN lms_submissions s ON s.submission_id = g.submission_id
            LEFT JOIN lms_assignments sa ON sa.assignment_id = s.assignment_id
            LEFT JOIN lms_assessment_attempts t ON t.attempt_id = g.attempt_id
            LEFT JOIN lms_assessments q ON q.assessment_id = t.assessment_id
            WHERE g.course_id = ? AND ' . ($conflicts ? 'NOT ' : '') . '(
        (a.assignment_id IS NULL OR a.course_id = g.course_id)
        AND (s.submission_id IS NULL OR (s.course_id = g.course_id AND s.student_user_id = g.student_user_id
             AND (g.assignment_id IS NULL OR s.assignment_id = g.assignment_id)))
        AND (sa.assignment_id IS NULL OR sa.course_id = g.course_id)
        AND (t.attempt_id IS NULL OR (t.course_id = g.course_id AND t.user_id = g.student_user_id))
        AND (q.assessment_id IS NULL OR q.course_id = g.course_id))';
}

function export_link_conflict_counts(PDO $pdo, int $courseId): array
{
    $queries = [
        'Lessons' => 'SELECT COUNT(*) FROM lms_lessons l LEFT JOIN lms_course_sections s
                       ON s.section_id = l.section_id AND s.course_id = l.course_id
                       WHERE l.course_id = ? AND s.section_id IS NULL',
        'Lesson completions' => 'SELECT COUNT(*) FROM lms_lesson_completions p
                        LEFT JOIN lms_lessons l ON l.lesson_id = p.lesson_id AND l.course_id = p.course_id
                        LEFT JOIN lms_course_sections s ON s.section_id = l.section_id AND s.course_id = p.course_id
                        WHERE p.course_id = ? AND (l.lesson_id IS NULL OR s.section_id IS NULL)',
        'Quiz attempts' => 'SELECT COUNT(*) FROM lms_assessment_attempts t
                        LEFT JOIN lms_assessments a ON a.assessment_id = t.assessment_id AND a.course_id = t.course_id
                        WHERE t.course_id = ? AND a.assessment_id IS NULL',
        'Submissions' => 'SELECT COUNT(*) FROM lms_submissions s
                        LEFT JOIN lms_assignments a ON a.assignment_id = s.assignment_id AND a.course_id = s.course_id
                        WHERE s.course_id = ? AND a.assignment_id IS NULL',
        'Grades' => 'SELECT COUNT(*) ' . export_grade_scope(true),
    ];
    $counts = [];
    foreach ($queries as $name => $sql) {
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$courseId]);
        $counts[] = ["Conflicts excluded · $name", (string)$stmt->fetchColumn()];
        $stmt->closeCursor();
    }
    return $counts;
}
