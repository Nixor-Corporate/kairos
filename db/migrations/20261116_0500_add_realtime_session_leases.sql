-- Only token hashes are stored. Existing PHP sessions can acquire a lease on their next /api/me.php request.
CREATE TABLE IF NOT EXISTS realtime_session_leases (
    token_hash BINARY(32) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    session_version INT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    PRIMARY KEY (token_hash),
    KEY idx_realtime_session_expiry (expires_at),
    CONSTRAINT fk_realtime_session_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Roll back the matched PHP, browser and relay code. Leave the additive table in place.
