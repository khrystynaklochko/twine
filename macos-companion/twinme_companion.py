#!/usr/bin/env python3
"""
TwinMe Studio — Local macOS Companion Bridge (AGENT-007 / AGENT-008)
Exposes a local HTTP server bound strictly to 127.0.0.1 requiring an expiring
pairing capability token, app allowlist enforcement, and instant emergency stop.
"""
import json
import os
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

ALLOWLISTED_APPS = {"Notes", "TextEdit", "Finder"}
PAIR_TOKEN = os.environ.get("TWINME_PAIR_TOKEN", "")
TOKEN_EXPIRES_AT = float(os.environ.get("TWINME_TOKEN_EXPIRES_AT", str(time.time() + 900)))
EMERGENCY_STOPPED = False


def check_accessibility_permission() -> bool:
    script = 'tell application "System Events" to return UI elements enabled'
    res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    return res.returncode == 0 and "true" in res.stdout.lower()


class CompanionHandler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if EMERGENCY_STOPPED:
            self._send(423, {"error": "Emergency stop active on macOS companion."})
            return False
        if not PAIR_TOKEN or time.time() > TOKEN_EXPIRES_AT:
            self._send(401, {"error": "Capability token missing or expired."})
            return False
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {PAIR_TOKEN}":
            self._send(403, {"error": "Invalid capability token."})
            return False
        return True

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {
                "platform": sys.platform,
                "accessibilityEnabled": check_accessibility_permission() if sys.platform == "darwin" else False,
                "emergencyStopped": EMERGENCY_STOPPED,
                "allowlistedApps": sorted(ALLOWLISTED_APPS),
            })
            return
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        global EMERGENCY_STOPPED
        if self.path == "/emergency-stop":
            EMERGENCY_STOPPED = True
            self._send(200, {"stopped": True})
            return
        if not self._authorized():
            return
        length = int(self.headers.get("Content-Length", "0"))
        data = json.loads(self.rfile.read(length) or b"{}")
        app_name = data.get("app", "")
        if app_name not in ALLOWLISTED_APPS:
            self._send(403, {"error": f"App '{app_name}' is not in macOS allowlist."})
            return
        if sys.platform != "darwin":
            self._send(400, {"error": "Companion actions require macOS (darwin)."})
            return
        if data.get("action") == "activate":
            subprocess.run(["osascript", "-e", f'tell application "{app_name}" to activate'], check=False)
            self._send(200, {"ok": True, "app": app_name, "action": "activate"})
            return
        self._send(400, {"error": "Unsupported companion action."})


if __name__ == "__main__":
    if not PAIR_TOKEN:
        print("Set TWINME_PAIR_TOKEN before starting TwinMe macOS Companion.", file=sys.stderr)
        sys.exit(1)
    server = HTTPServer(("127.0.0.1", 48720), CompanionHandler)
    print("TwinMe macOS Companion listening on http://127.0.0.1:48720")
    server.serve_forever()
