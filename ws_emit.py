"""CLI helper to forward Signoff events to the websocket relay."""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_EMIT_URL = "http://127.0.0.1:8090/emit"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _load_payload(raw: str | None):
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def send_event(url: str, secret: str, event: dict) -> int:
    target = urllib.parse.urlsplit(url)
    if (target.scheme != "http" or target.hostname not in {"127.0.0.1", "::1"}
            or target.username is not None or target.password is not None
            or target.path != "/emit" or target.query or target.fragment):
        raise ValueError("WS_EMIT_URL must be a loopback HTTP /emit endpoint")
    data = json.dumps(event).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Kairos-WS-Secret": secret,
        },
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(req, timeout=10) as resp:
        resp.read()
        return resp.status


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", required=True, help="event name to emit")
    parser.add_argument("--course-id", type=int, default=None)
    parser.add_argument("--room-id", type=int, default=None)
    parser.add_argument("--ref-id", type=int, default=None)
    parser.add_argument("--payload", default=None, help="JSON payload (or raw string)")
    parser.add_argument(
        "--url",
        default=os.environ.get("WS_EMIT_URL", DEFAULT_EMIT_URL),
        help="HTTP endpoint for websocket relay (default: %(default)s)",
    )

    args = parser.parse_args(argv)
    secret = os.environ.get("WS_SHARED_SECRET", "")
    if not secret:
        parser.error("WS_SHARED_SECRET must be set in the environment")

    payload = _load_payload(args.payload)
    message = {
        "event": args.event,
        "course_id": args.course_id,
        "room_id": args.room_id,
        "ref_id": args.ref_id,
        "payload": payload,
    }

    try:
        status = send_event(args.url, secret, message)
        print(f"sent relay event (status={status})")
        return 0
    except urllib.error.HTTPError as exc:  # pragma: no cover - CLI diagnostics
        print(f"relay HTTP error (status={exc.code})", file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover - CLI diagnostics
        print(f"relay request failed ({type(exc).__name__})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
