-- Preserve course membership evidence for future manager removals.
-- Existing academic records and enrollment grants are unchanged.
CREATE TABLE IF NOT EXISTS course_student_withdrawals (
  course_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  withdrawn_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Roll back application code while retaining the evidence table.
