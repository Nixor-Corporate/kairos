-- Apply before the code release. Existing progress records are untouched.
CREATE TABLE IF NOT EXISTS signoff_policies (
  course_id BIGINT UNSIGNED NOT NULL,
  rating_required TINYINT(1) NOT NULL DEFAULT 0,
  comment_required TINYINT(1) NOT NULL DEFAULT 0,
  revision INT UNSIGNED NOT NULL,
  PRIMARY KEY (course_id),
  FOREIGN KEY (course_id) REFERENCES courses (course_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS signoff_rating_options (
  option_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(120) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (option_id),
  KEY idx_signoff_options_course (course_id, sort_order, option_id),
  FOREIGN KEY (course_id) REFERENCES signoff_policies (course_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Snapshot every configuration revision together with its actor.
CREATE TABLE IF NOT EXISTS signoff_policy_history (
  course_id BIGINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  configuration JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Independent history survives a progress reset and snapshots labels across scale edits.
CREATE TABLE IF NOT EXISTS signoff_history (
  signoff_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  detail_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  previous_status VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  policy_revision INT UNSIGNED NOT NULL,
  rating_option_id BIGINT UNSIGNED DEFAULT NULL,
  rating_label VARCHAR(120) DEFAULT NULL,
  signoff_comment TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (signoff_event_id),
  KEY idx_signoff_history_course (course_id, signoff_event_id),
  KEY idx_signoff_history_student (course_id, student_user_id, signoff_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Rollback by restoring the prior application while retaining these tables for audit.
-- Drop only after an approved retention review and verified backup.
