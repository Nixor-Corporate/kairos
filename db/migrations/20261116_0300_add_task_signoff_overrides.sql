-- Apply after 20261116_0200_add_signoff_requirements.sql.
-- Existing policy and completion records are unchanged.
CREATE TABLE IF NOT EXISTS signoff_task_policy_history (
  course_id BIGINT UNSIGNED NOT NULL,
  detail_id BIGINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  configuration JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id, detail_id, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS signoff_task_event_policies (
  signoff_event_id BIGINT UNSIGNED NOT NULL,
  task_revision INT UNSIGNED NOT NULL,
  rating_position SMALLINT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (signoff_event_id),
  FOREIGN KEY (signoff_event_id) REFERENCES signoff_history (signoff_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Application rollback can leave both additive tables in place. Retain audit data.
