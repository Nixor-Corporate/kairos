<?php
declare(strict_types=1);

require_once __DIR__ . '/XlsxWorkbook.php';

function export_progress_workbook(PDO $pdo, int $courseId, string $path): void
{
    [$roster, $rosterArgs] = rbac_course_students_query($pdo, $courseId);
    $workbook = new XlsxWorkbook($path);
    $sheets = [
        'Enrollments' => [
            ['Course ID', 'Course', 'Course code', 'Student ID', 'Student name'],
            'SELECT c.course_id, c.name AS course_name, c.code, u.user_id, u.name AS student_name
             FROM roster e JOIN users u USING (user_id) JOIN courses c ON c.course_id = ? ORDER BY u.user_id',
        ],
        'Tasks' => [
            ['Course ID', 'Category ID', 'Category', 'Task ID', 'Task'],
            'SELECT c.course_id, c.category_id, c.name AS category_name, d.detail_id, d.name AS task_name
             FROM progress_details d JOIN progress_category c ON c.category_id = d.category_id
             WHERE c.course_id = ? ORDER BY c.category_id, d.detail_id',
        ],
        'Task progress' => [
            ['Course ID', 'Student ID', 'Task ID', 'Status', 'Created at' => 'date', 'Updated at' => 'date'],
            'SELECT c.course_id, p.user_id, p.detail_id, s.name, p.created_at, p.updated_at
             FROM progress p JOIN roster e USING (user_id)
             JOIN progress_details d ON d.detail_id = p.detail_id
             JOIN progress_category c ON c.category_id = d.category_id
             JOIN progress_status s ON s.progress_status_id = p.status_id
             WHERE c.course_id = ? ORDER BY p.user_id, p.detail_id',
        ],
        'Sign-off history' => [
            ['Event ID', 'Course ID', 'Student ID', 'Task ID', 'Staff ID', 'Staff name', 'Previous status',
             'Status', 'Policy revision' => 'number', 'Rating option ID', 'Rating label', 'Sign-off comment', 'Recorded at' => 'date'],
            'SELECT h.signoff_event_id, h.course_id, h.student_user_id, h.detail_id, h.actor_user_id,
                    u.name, h.previous_status, h.status, h.policy_revision, h.rating_option_id, h.rating_label,
                    h.signoff_comment, h.created_at
             FROM signoff_history h JOIN roster e ON e.user_id = h.student_user_id
             LEFT JOIN users u ON u.user_id = h.actor_user_id
             WHERE h.course_id = ? ORDER BY h.signoff_event_id',
        ],
        'Serving sessions' => [
            ['Course ID', 'Queue ID', 'Serving ID', 'Student ID', 'TA ID', 'TA name', 'Started at' => 'date',
             'Ended at' => 'date', 'Completed at' => 'date', 'Finished at' => 'date'],
            'SELECT r.course_id, a.queue_id, a.ta_assignment_id, a.student_user_id, a.ta_user_id, u.name,
                    a.started_at, a.ended_at, a.completed_at, a.finished_at
             FROM ta_assignments a JOIN roster e ON e.user_id = a.student_user_id
             JOIN queues q ON q.queue_id = a.queue_id JOIN rooms r ON r.room_id = q.room_id
             LEFT JOIN users u ON u.user_id = a.ta_user_id
             WHERE r.course_id = ? ORDER BY a.ta_assignment_id',
        ],
        'Modules' => [
            ['Course ID', 'Module ID', 'Module', 'Order' => 'number', 'Published (0 or 1)' => 'number'],
            'SELECT course_id, section_id, title, position, is_published FROM lms_course_sections
             WHERE course_id = ? AND deleted_at IS NULL ORDER BY position, section_id',
        ],
        'Lessons' => [
            ['Course ID', 'Module ID', 'Lesson ID', 'Lesson', 'Order' => 'number'],
            'SELECT l.course_id, l.section_id, l.lesson_id, l.title, l.position
             FROM lms_lessons l JOIN lms_course_sections s ON s.section_id = l.section_id AND s.course_id = l.course_id
             WHERE l.course_id = ? AND l.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY l.section_id, l.position, l.lesson_id',
        ],
        'Lesson completions' => [
            ['Completion ID', 'Course ID', 'Module ID', 'Lesson ID', 'Student ID', 'Completed at' => 'date'],
            'SELECT p.completion_id, p.course_id, l.section_id, p.lesson_id, p.user_id, p.completed_at
             FROM lms_lesson_completions p JOIN roster e USING (user_id)
             JOIN lms_lessons l ON l.lesson_id = p.lesson_id AND l.course_id = p.course_id
             JOIN lms_course_sections s ON s.section_id = l.section_id AND s.course_id = p.course_id
             WHERE p.course_id = ? AND l.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY p.completion_id',
        ],
        'Quizzes' => [
            ['Course ID', 'Assessment ID', 'Assessment', 'Type', 'Status', 'Due at' => 'date'],
            'SELECT course_id, assessment_id, title, assessment_type, status, due_at FROM lms_assessments
             WHERE course_id = ? AND deleted_at IS NULL ORDER BY assessment_id',
        ],
        'Quiz attempts' => [
            ['Attempt ID', 'Course ID', 'Assessment ID', 'Student ID', 'Status', 'Grading status',
             'Score' => 'number', 'Maximum score' => 'number', 'Started at' => 'date', 'Submitted at' => 'date',
             'Graded by ID', 'Graded at' => 'date', 'Released at' => 'date'],
            'SELECT t.attempt_id, t.course_id, t.assessment_id, t.user_id, t.status, t.grading_status, t.score,
                    t.max_score, t.started_at, t.submitted_at, t.graded_by, t.graded_at, t.released_at
             FROM lms_assessment_attempts t JOIN roster e USING (user_id)
             JOIN lms_assessments a ON a.assessment_id = t.assessment_id AND a.course_id = t.course_id
             WHERE t.course_id = ? AND a.deleted_at IS NULL ORDER BY t.attempt_id',
        ],
        'Assignments' => [
            ['Course ID', 'Assignment ID', 'Assignment', 'Status', 'Maximum points' => 'number', 'Due at' => 'date'],
            'SELECT course_id, assignment_id, title, status, max_points, due_at FROM lms_assignments
             WHERE course_id = ? AND deleted_at IS NULL ORDER BY assignment_id',
        ],
        'Submissions' => [
            ['Submission ID', 'Course ID', 'Assignment ID', 'Student ID', 'Version' => 'number',
             'Status', 'Late (0 or 1)' => 'number', 'Submitted at' => 'date', 'Updated at' => 'date'],
            'SELECT s.submission_id, s.course_id, s.assignment_id, s.student_user_id, s.version, s.status,
                    s.is_late, s.submitted_at, s.updated_at
             FROM lms_submissions s JOIN roster e ON e.user_id = s.student_user_id
             JOIN lms_assignments a ON a.assignment_id = s.assignment_id AND a.course_id = s.course_id
             WHERE s.course_id = ? AND a.deleted_at IS NULL ORDER BY s.submission_id',
        ],
        'Grades' => [
            ['Grade ID', 'Course ID', 'Student ID', 'Assignment ID', 'Submission ID', 'Attempt ID', 'Status',
             'Score' => 'number', 'Maximum score' => 'number', 'Override score' => 'number', 'Effective score' => 'number',
             'Grader ID', 'Released by ID', 'Released at' => 'date', 'Updated at' => 'date'],
            'SELECT g.grade_id, g.course_id, g.student_user_id, g.assignment_id, g.submission_id, g.attempt_id,
                    g.status, g.score, g.max_score, g.grade_override, COALESCE(g.grade_override, g.score),
                    g.graded_by, g.released_by, g.released_at, g.updated_at
             FROM lms_grades g JOIN roster e ON e.user_id = g.student_user_id
             LEFT JOIN lms_assignments a ON a.assignment_id = g.assignment_id AND a.course_id = g.course_id AND a.deleted_at IS NULL
             LEFT JOIN lms_submissions s ON s.submission_id = g.submission_id AND s.course_id = g.course_id
                 AND s.student_user_id = g.student_user_id AND s.assignment_id = a.assignment_id
             LEFT JOIN lms_assessment_attempts t ON t.attempt_id = g.attempt_id AND t.course_id = g.course_id AND t.user_id = g.student_user_id
             LEFT JOIN lms_assessments q ON q.assessment_id = t.assessment_id AND q.course_id = g.course_id AND q.deleted_at IS NULL
             WHERE g.course_id = ? AND (a.assignment_id IS NOT NULL OR (g.assignment_id IS NULL AND q.assessment_id IS NOT NULL))
               AND (g.submission_id IS NULL OR s.submission_id IS NOT NULL)
               AND (g.attempt_id IS NULL OR q.assessment_id IS NOT NULL)
             ORDER BY g.grade_id',
        ],
    ];

    $workbook->addSheet('About', ['Field' => 'text', 'Value' => 'text'], [
        ['Course ID', (string)$courseId],
        ['Scope', 'Currently enrolled students and academic records for the selected course'],
        ['Progress', 'Missing task progress and lesson completion rows indicate no recorded status'],
        ['Timestamps', 'Database wall time as recorded by Kairos'],
        ['Privacy', 'Academic records. Handle using institutional data-access rules.'],
    ]);

    foreach ($sheets as $name => [$columns, $sql]) {
        $columnsByName = [];
        foreach ($columns as $label => $type) {
            if (is_int($label)) {
                $columnsByName[$type] = 'text';
            } else {
                $columnsByName[$label] = $type;
            }
        }
        $usesRoster = str_contains($sql, 'roster e');
        $stmt = $pdo->prepare($usesRoster ? "WITH roster AS ($roster) $sql" : $sql);
        $stmt->execute($usesRoster ? [...$rosterArgs, $courseId] : [$courseId]);
        $rows = (static function () use ($stmt): Generator {
            try {
                while ($row = $stmt->fetch(PDO::FETCH_NUM)) {
                    yield $row;
                }
            } finally {
                $stmt->closeCursor();
            }
        })();
        $workbook->addSheet($name, $columnsByName, $rows);
    }
    $workbook->finish();
}
