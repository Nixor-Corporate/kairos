<?php
declare(strict_types=1);

/** @return array{token: string, issued_at: int, expires_at: int} */
function kairos_realtime_lease(PDO $pdo, int $userId, int $version, int $ttl): array
{
    $previous = $_SESSION['realtime_lease'] ?? null;
    if (is_array($previous) && $previous['expires_at'] > time() + 15) {
        $check = $pdo->prepare(
            'SELECT 1 FROM realtime_session_leases WHERE token_hash = UNHEX(?) AND user_id = ?
             AND session_version = ? AND expires_at > UTC_TIMESTAMP()'
        );
        $check->execute([hash('sha256', $previous['token']), $userId, $version]);
        if ($check->fetchColumn()) {
            return $previous;
        }
    }

    kairos_revoke_realtime_token();
    $pdo->exec('DELETE FROM realtime_session_leases WHERE expires_at <= UTC_TIMESTAMP() ORDER BY expires_at LIMIT 100');
    $token = bin2hex(random_bytes(32));
    $issuedAt = time();
    $stmt = $pdo->prepare(
        'INSERT INTO realtime_session_leases (token_hash, user_id, session_version, expires_at)
         VALUES (UNHEX(?), ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))'
    );
    $stmt->execute([hash('sha256', $token), $userId, $version, $ttl]);
    return $_SESSION['realtime_lease'] = ['token' => $token, 'issued_at' => $issuedAt, 'expires_at' => $issuedAt + $ttl];
}

function kairos_revoke_realtime_token(): void
{
    $token = $_SESSION['realtime_lease']['token'] ?? null;
    if (is_string($token)) {
        $stmt = db()->prepare('DELETE FROM realtime_session_leases WHERE token_hash = UNHEX(?)');
        $stmt->execute([hash('sha256', $token)]);
        unset($_SESSION['realtime_lease']);
    }
}
