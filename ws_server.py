"""WSGI-compatible Flask-SocketIO relay for Signoff events."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import re
import threading
import time
from contextlib import closing
from dataclasses import dataclass
from typing import Any, Dict, Optional, Set
from urllib.parse import urlsplit

import pymysql
from flask import Flask, abort, jsonify, request
from flask_socketio import SocketIO
from werkzeug.exceptions import HTTPException

from ws_relay_access import RelayAccess


def _load_env_file(path: str) -> None:
    """Load KEY=VALUE pairs from a .env file for parity with the PHP app."""

    if not os.path.isfile(path):
        return

    try:
        with open(path, "r", encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError:
        return

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.lower().startswith("export "):
            key = key[7:].strip()
        if not key:
            continue
        value = value.strip()
        if value and value[0] in {'"', "'"} and value[-1:] == value[0]:
            quote = value[0]
            value = value[1:-1]
            value = value.replace(f"\\{quote}", quote)
        os.environ.setdefault(key, value)


_load_env_file(os.path.join(os.path.dirname(__file__), ".env"))


def _normalize_socket_path(raw: str) -> str:
    """Return a Socket.IO path that matches the JS client expectations.

    ``flask_socketio.SocketIO`` expects the ``path`` parameter without a leading
    slash.  The browser client, however, requests ``/<path>`` and often includes a
    trailing slash.  To keep both sides happy we ensure the public path always
    begins with a single slash and omit that slash when handing the value to the
    Socket.IO server.
    """

    value = (raw or "").strip() or "/websocket/socket.io"
    if not value.startswith("/"):
        value = f"/{value}"
    return value.rstrip("/") or "/socket.io"


DEFAULT_CHANNELS = {"rooms", "queue", "progress", "ta_accept", "projector"}
WS_SOCKET_PATH = _normalize_socket_path(os.getenv("WS_SOCKET_PATH", "/websocket/socket.io/"))
WS_SHARED_SECRET = os.getenv("WS_SHARED_SECRET", "").strip()
WS_DB_USER = os.getenv("WS_DB_USERNAME")
WS_DB_PASSWORD = os.getenv("WS_DB_PASSWORD")
WS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("WS_ALLOWED_ORIGINS", "https://kairos.nixorcorporate.com").split(",")
    if origin.strip()
]
WS_EMIT_MAX_BYTES = int(os.getenv("WS_EMIT_MAX_BYTES", "65536") or 65536)
EVENT_NAME_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
TOKEN_RE = re.compile(r"[a-f0-9]{64}")
LMS_CHANNELS = {"lms_content", "lms_quiz", "lms_assignment", "lms_grade", "lms_analytics", "lms_announcement"}
OUTBOX_POLL_SECONDS = float(os.getenv("LMS_OUTBOX_POLL_SECONDS", "1") or 1)
LMS_OUTBOX_ENABLED = (os.getenv("LMS_OUTBOX_ENABLED", "1") or "1").strip() not in {"0", "false", "False"}

if not WS_SHARED_SECRET:
    raise RuntimeError("WS_SHARED_SECRET must be configured")
if (WS_DB_USER is not None or WS_DB_PASSWORD is not None) and not (WS_DB_USER and WS_DB_PASSWORD):
    raise RuntimeError("WS_DB_USERNAME and WS_DB_PASSWORD must be configured together")


def _valid_origin(value: str) -> bool:
    url = urlsplit(value)
    secure = url.scheme == "https" or (url.scheme == "http" and url.hostname in {"127.0.0.1", "::1", "localhost"})
    return (secure and bool(url.hostname) and "*" not in value and url.username is None and url.password is None
            and not (url.path or url.query or url.fragment))


if not WS_ALLOWED_ORIGINS or not all(_valid_origin(origin) for origin in WS_ALLOWED_ORIGINS):
    raise RuntimeError("WS_ALLOWED_ORIGINS must contain exact HTTPS or development loopback origins")


def _open_db(*, autocommit: bool = True):
    return pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306") or 3306),
        user=WS_DB_USER if WS_DB_USER is not None else os.getenv("DB_USERNAME", ""),
        password=WS_DB_PASSWORD if WS_DB_PASSWORD is not None else os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_DATABASE", "kairos"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=autocommit,
        connect_timeout=5,
        read_timeout=5,
        write_timeout=5,
    )


def _parse_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        parsed = int(str(value).strip())
        return parsed if 0 < parsed <= (2**63 - 1) else None
    except (TypeError, ValueError):
        return None


def _parse_channels(raw: Optional[str]) -> Set[str]:
    if not raw:
        return set(DEFAULT_CHANNELS)
    requested = {part.strip() for part in raw.split(",") if part.strip()}
    return requested & (DEFAULT_CHANNELS | LMS_CHANNELS)


def _build_payload(message: Dict[str, Any]) -> Dict[str, Any]:
    payload_raw = message.get("payload")
    if isinstance(payload_raw, dict):
        payload = payload_raw
    else:
        payload = {"value": payload_raw}
    return {
        "type": "event",
        "event": str(message.get("event") or "").strip(),
        "course_id": _parse_int(message.get("course_id")),
        "room_id": _parse_int(message.get("room_id")),
        "ref_id": _parse_int(message.get("ref_id")),
        "payload": payload,
        "ts": int(time.time()),
    }


@dataclass
class ClientState:
    sid: str
    user_id: int
    token_hash: str
    channels: Set[str]
    course_id: Optional[int]
    room_id: Optional[int]


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = WS_EMIT_MAX_BYTES
_socketio_internal_path = WS_SOCKET_PATH.lstrip("/") or "socket.io"
socketio = SocketIO(
    app,
    async_mode="eventlet",
    cors_allowed_origins=WS_ALLOWED_ORIGINS,
    path=_socketio_internal_path,
    logger=False,
    engineio_logger=False,
)

_connections: Dict[str, ClientState] = {}
_connections_lock = threading.Lock()

# Expose a conventional WSGI entrypoint for hosting environments that expect an
# ``application`` object (e.g., ``gunicorn ws_server:application``). Without
# this alias, importing the module would raise ``AttributeError: module has no
# attribute 'application'`` and prevent the websocket relay from starting.
application = app


def _record_connection(sid: str, state: ClientState) -> None:
    with _connections_lock:
        _connections[sid] = state


def _drop_connection(sid: str) -> None:
    with _connections_lock:
        _connections.pop(sid, None)


def _event_channel(event_name: str) -> Optional[str]:
    if event_name in ("projector_serve", "projector_call_again"):
        return "projector"
    return event_name if event_name in DEFAULT_CHANNELS else None


def _matches_subscription(state: ClientState, channel: Optional[str], course_id: int,
                          room_id: Optional[int], target_id: Optional[int]) -> bool:
    if channel is None:
        return state.course_id == course_id and bool(state.channels & LMS_CHANNELS)
    if channel not in state.channels:
        return False
    if channel == "ta_accept":
        return (state.user_id == target_id and state.course_id in (None, course_id)
                and state.room_id in (None, room_id))
    return state.course_id == course_id and (room_id is None or state.room_id == room_id)


def _can_receive(state: ClientState, staff: bool, channel: Optional[str], event: str,
                 payload: Dict[str, Any], target_id: Optional[int]) -> bool:
    if channel == "projector":
        return staff
    if channel == "progress":
        return staff or state.user_id == target_id
    if channel is not None:
        return True

    if event.startswith("announcement."):
        return staff or payload.get("audience") == "course"
    if payload.get("status") == "draft" and event.startswith(("quiz.", "assignment.")):
        return staff
    if event.startswith(("grade.", "quiz.attempt.", "assignment.submission.", "grading.")) or event in (
        "lesson.completed", "course.enrollment.updated"
    ):
        return staff or state.user_id == target_id
    return True


def _emit_authorized(payload: Dict[str, Any], *, lms: bool = False) -> int:
    event = payload.get("event_name" if lms else "event")
    if not isinstance(event, str) or EVENT_NAME_RE.fullmatch(event) is None or (lms and "." not in event):
        return 0
    channel = None if lms else _event_channel(event)
    if not lms and channel is None:
        return 0
    course_id = _parse_int(payload.get("course_id"))
    room_id = _parse_int(payload.get("room_id"))
    if course_id is None and room_id is None:
        return 0
    if any(payload.get(key) is not None and value is None for key, value in (
        ("course_id", course_id), ("room_id", room_id)
    )):
        return 0

    details = payload if lms else payload["payload"]
    target_id = _parse_int(details.get("student_user_id") or details.get("user_id"))
    if lms and target_id is None and (
        event.startswith(("quiz.attempt.", "assignment.submission.")) or event == "course.enrollment.updated"
    ):
        target_id = _parse_int(details.get("actor_id"))

    with _connections_lock:
        clients = tuple(_connections.values())
    if not clients:
        return 0

    sent = 0
    with closing(_open_db()) as connection, connection.cursor() as cursor:
        access = RelayAccess(cursor)
        course_id = access.resolve_course(course_id, room_id)
        if course_id is None:
            return 0
        for state in clients:
            if not _matches_subscription(state, channel, course_id, room_id, target_id):
                continue
            identity = access.identity(state.token_hash)
            if identity is None or identity[0] != state.user_id:
                socketio.server.disconnect(state.sid, namespace="/")
                continue
            allowed, staff = access.course_access(identity, course_id)
            if not allowed:
                if state.course_id is not None:
                    socketio.server.disconnect(state.sid, namespace="/")
                continue
            if _can_receive(state, staff, channel, event, details, target_id):
                socketio.emit(event, payload, to=state.sid)
                sent += 1
    return sent


def _outbox_worker() -> None:
    if not LMS_OUTBOX_ENABLED:
        app.logger.info("LMS outbox worker disabled")
        return

    while True:
        connection = None
        try:
            connection = _open_db(autocommit=False)
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT event_id, payload_json FROM lms_event_outbox WHERE delivered_at IS NULL ORDER BY occurred_at ASC LIMIT 50 FOR UPDATE"
                )
                rows = cursor.fetchall()
                if not rows:
                    connection.commit()
                    time.sleep(OUTBOX_POLL_SECONDS)
                    continue

                delivered_ids = []
                for row in rows:
                    payload = row.get("payload_json")
                    if isinstance(payload, str):
                        payload = json.loads(payload)
                    if not isinstance(payload, dict):
                        payload = {"event": "lms.event", "payload": payload}
                    payload.setdefault("event_name", payload.get("event", "lms.event"))
                    _emit_authorized(payload, lms=True)
                    delivered_ids.append(row["event_id"])

                update_sql = "UPDATE lms_event_outbox SET delivered_at = NOW() WHERE event_id IN (" + ",".join(["%s"] * len(delivered_ids)) + ")"
                cursor.execute(update_sql, delivered_ids)
                connection.commit()
        except Exception as exc:  # pragma: no cover
            app.logger.error("LMS outbox worker error class=%s", type(exc).__name__)
            if connection is not None:
                try:
                    connection.rollback()
                except Exception:
                    pass
            time.sleep(max(OUTBOX_POLL_SECONDS, 1.0))
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass


@socketio.on("connect")
def handle_connect(auth=None):
    if request.headers.get("Origin") not in WS_ALLOWED_ORIGINS:
        return False
    token = auth.get("token") if isinstance(auth, dict) else None
    if not isinstance(token, str) or TOKEN_RE.fullmatch(token) is None:
        return False
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()

    channels = _parse_channels(request.args.get("channels"))
    course_id = _parse_int(request.args.get("course_id"))
    room_id = _parse_int(request.args.get("room_id"))
    if not channels or any(key in request.args and value is None for key, value in (
        ("course_id", course_id), ("room_id", room_id)
    )):
        return False

    try:
        with closing(_open_db()) as connection, connection.cursor() as cursor:
            access = RelayAccess(cursor)
            identity = access.identity(token_hash)
            if identity is None:
                return False
            if course_id is not None or room_id is not None:
                course_id = access.resolve_course(course_id, room_id)
                if course_id is None:
                    return False
                allowed, staff = access.course_access(identity, course_id)
                if not allowed:
                    return False
                if not staff or room_id is None:
                    channels.discard("projector")
            else:
                channels.discard("projector")
            if not channels:
                return False
    except Exception as error:
        app.logger.warning("realtime subscription unavailable class=%s", type(error).__name__)
        return False

    state = ClientState(request.sid, identity[0], token_hash, channels, course_id, room_id)
    _record_connection(request.sid, state)


@socketio.on("disconnect")
def handle_disconnect():
    _drop_connection(request.sid)


@app.post("/emit")
def handle_emit():
    peer = ipaddress.ip_address(request.remote_addr) if request.remote_addr is not None else None
    provided_secret = request.headers.get("X-Kairos-WS-Secret", "")
    if (peer is None or not peer.is_loopback or request.headers.get("Origin") is not None
            or not hmac.compare_digest(provided_secret.encode(), WS_SHARED_SECRET.encode())):
        abort(403)

    if request.content_length is not None and request.content_length > WS_EMIT_MAX_BYTES:
        abort(413)

    message = request.get_json(silent=True)
    if not isinstance(message, dict):
        abort(400, description="invalid json payload")

    event_name = str(message.get("event") or "").strip()
    if EVENT_NAME_RE.fullmatch(event_name) is None or _event_channel(event_name) is None:
        abort(400, description="event is required")

    outbound = _build_payload(message)
    for key in ("course_id", "room_id"):
        if message.get(key) is not None and outbound[key] is None:
            abort(400, description="invalid scope")
    if outbound["course_id"] is None and outbound["room_id"] is None:
        abort(400, description="scope is required")

    recipients = _emit_authorized(outbound)
    return jsonify({"ok": True, "sent": recipients})


@app.errorhandler(Exception)
def handle_exception(exc: Exception):
    if isinstance(exc, HTTPException):
        if exc.code >= 500:
            app.logger.error("relay HTTP error status=%s", exc.code)
        return exc

    app.logger.error("relay request error class=%s", type(exc).__name__)
    return jsonify({"ok": False, "error": "internal_error"}), 500


if LMS_OUTBOX_ENABLED:
    threading.Thread(target=_outbox_worker, daemon=True).start()

if __name__ == "__main__":
    socketio.run(
        app,
        host="127.0.0.1",
        port=8090,
    )


__all__ = ["app", "socketio", "application"]
