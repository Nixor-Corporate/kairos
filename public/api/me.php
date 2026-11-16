<?php
declare(strict_types=1);

require_once __DIR__.'/bootstrap.php';
require_once dirname(__DIR__, 2) . '/src/realtime_session.php';

header('Cache-Control: private, no-store');

if (empty($_SESSION['user'])) {
  json_out([]);
}

$user = require_login();
$wsInfo = [
  'ws_url' => null,
  'token' => null,
  'user_id' => isset($user['user_id']) ? (int)$user['user_id'] : null,
  'ts' => null,
];

$publicUrl = env('WS_PUBLIC_URL', '');
if ($publicUrl !== '') {
  $publicUrl = rtrim($publicUrl, '/');
}

$socketPath = env('WS_SOCKET_PATH', '/websocket/socket.io');
if (!is_string($socketPath) || $socketPath === '') {
  $socketPath = '/websocket/socket.io';
}

$secret = env('WS_SHARED_SECRET', '');
if ($secret !== '' && $publicUrl !== '' && !empty($user['user_id'])) {
  $ttl = max(30, min(600, (int)env('WS_TOKEN_TTL', '600')));
  try {
    $lease = kairos_realtime_lease(db(), (int)$user['user_id'], (int)$_SESSION['auth_session_version'], $ttl);
    $wsInfo['token'] = $lease['token'];
    $wsInfo['ws_url'] = $publicUrl;
    $wsInfo['ts'] = $lease['issued_at'];
    $wsInfo['expires_at'] = $lease['expires_at'];
    $wsInfo['socket_path'] = '/' . ltrim($socketPath, '/');
  } catch (PDOException $error) {
    // Realtime is optional. The already authenticated REST identity remains usable.
    error_log('[kairos] realtime lease issuance failed: ' . get_class($error));
  }
} else {
  $wsInfo['ws_url'] = $publicUrl !== '' ? $publicUrl : null;
}

$user['ws'] = $wsInfo;

json_out($user);
