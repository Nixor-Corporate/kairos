-- Archive definitions without removing student progress or sign-off history.
ALTER TABLE progress_category ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL;
ALTER TABLE progress_details ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS signoff_catalog_history (
  event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  detail_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(12) NOT NULL,
  previous_name VARCHAR(255) NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  KEY idx_signoff_catalog_course (course_id, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Retain archive markers and audit data on rollback. Prior code will display archived definitions.
