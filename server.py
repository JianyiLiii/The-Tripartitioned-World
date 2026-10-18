#!/usr/bin/env python3
"""The Tripartitioned World - projects and meetings across time zones.

This file is the whole backend: a dependency-free HTTP server (Python 3.9+)
that serves the frontend in ./public plus a small JSON API, and keeps all data
in ./data/db.json.

Enter a name to create or resume a local profile. ALLOWED_NAMES is an optional
list of initial profiles for compatibility with earlier versions.

    python server.py                    # http://localhost:8000
    python server.py --port 9000 --open

Settings (environment variables, or KEY=value lines in .env):
    ALLOWED_NAMES   initial profile names, comma separated (optional)
    HOST / PORT     listen address, default 127.0.0.1 / 8000
    DATA_DIR        data folder, default ./data
    SESSION_DAYS    how long a sign-in lasts, default 30
    TRUST_PROXY     1 = running behind a tunnel or reverse proxy: take the
                    client IP and https flag from X-Forwarded-* headers
"""

import argparse
import base64
import datetime
import errno
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import traceback
import unicodedata
import webbrowser
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from access_control import (AccessConfigError, AccessList, DEFAULT_PASSWORD, DUMMY_HASH,
                            hash_password, normalized_name, valid_password, verify_password,
                            load_document, write_document)

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"

COOKIE_NAME = "overlap_session"
MAX_BODY_BYTES = 64 * 1024
WEEK_MINUTES = 7 * 24 * 60
MIN_DURATION, MAX_DURATION = 15, 12 * 60

NAME_SEPARATORS = re.compile(r"[,;\r\n，、；]+")
TIME_ZONE = re.compile(r"^[A-Za-z][A-Za-z0-9_+\-]{0,40}(?:/[A-Za-z0-9_+\-]{1,40}){0,3}$")
PROJECT_PATH = r"/api/projects/([A-Za-z0-9_-]{6,32})"
WORKSPACE_PATH = r"/api/workspaces/([A-Za-z0-9_-]{6,32})"
INVITE_PATH = r"/api/invites/([A-Za-z0-9_-]{16,64})"
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".txt": "text/plain; charset=utf-8",
    ".woff2": "font/woff2",
}

CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    # Fonts come from Google Fonts; without a connection the system fonts are used.
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


# ---------------------------------------------------------------- settings --

def read_env_file(path):
    """Parse KEY=value lines. Values may be quoted; '#' starts a comment line."""
    values = {}
    try:
        text = Path(path).read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return values
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key] = value
    return values


def clean_name(raw):
    return " ".join(unicodedata.normalize("NFKC", raw).split())


def name_key(raw):
    """Names match case-insensitively and ignore extra spaces."""
    return clean_name(raw).casefold()


def parse_members(raw):
    members, seen = [], set()
    for part in NAME_SEPARATORS.split(raw or ""):
        name = clean_name(part)
        key = name.casefold()
        if not name or key in seen:
            continue
        seen.add(key)
        members.append({"key": key, "name": name, "index": len(members)})
    return members


class Config:
    def __init__(self, args, defaults=None):
        from_file = read_env_file(args.env_file)
        defaults = defaults or {}

        def setting(key, default=""):
            return os.environ.get(key, from_file.get(key, defaults.get(key, default)))

        self.members = parse_members(setting("ALLOWED_NAMES"))
        self.host = args.host or setting("HOST", "127.0.0.1")
        self.port = args.port if args.port is not None else int(setting("PORT", "8000"))
        data_dir = Path(args.data_dir or setting("DATA_DIR", "data")).expanduser()
        self.data_dir = data_dir if data_dir.is_absolute() else ROOT / data_dir
        self.session_seconds = int(float(setting("SESSION_DAYS", "30")) * 86400)
        self.require_password_change = setting("REQUIRE_PASSWORD_CHANGE", "0").lower() in ("1", "true", "yes")
        self.max_users = int(setting("MAX_USERS", "0"))
        self.owner_user_key = name_key(setting("OWNER_USER_KEY")) if setting("OWNER_USER_KEY").strip() else None
        if self.max_users < 0:
            raise ValueError("MAX_USERS must be non-negative (0 disables the global cap)")
        self.trust_proxy = setting("TRUST_PROXY").strip().lower() in ("1", "true", "yes", "on")
        self.session_secret = setting("SESSION_SECRET")
        self.auth_mode = setting("AUTH_MODE", "local").strip().lower()
        self.storage = setting("STORAGE", "json").strip().lower()
        if self.auth_mode not in ("local", "restricted"):
            raise ValueError("AUTH_MODE must be local or restricted")
        if self.storage not in ("json", "sqlite", "locked-json"):
            raise ValueError("STORAGE must be json, locked-json or sqlite")
        access_path = Path(setting("ACCESS_USERS_FILE", "config/access-users.json")).expanduser()
        self.access_users_file = access_path if access_path.is_absolute() else ROOT / access_path
        self.hosting = setting("HOSTING", "cloud" if self.auth_mode == "restricted" else "local")
        self.require_https = setting("REQUIRE_HTTPS", "0").strip().lower() in ("1", "true", "yes", "on")


# ------------------------------------------------------------------ storage --

class Store:
    """All app data in one JSON file. A small team means small data: load it
    once, keep it in memory, and write the whole file on every change."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        self.data = {"version": 2, "projects": {}, "workspaces": {}, "users": {},
                     "availability": {}, "profiles": {}, "credentials": {}}
        if path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
            except ValueError as err:
                raise SystemExit(f"{path} is not valid JSON ({err}). Fix it or move it away.")
            for key, empty in self.data.items():
                if isinstance(loaded.get(key), type(empty)):
                    self.data[key] = loaded[key]

    def commit(self):
        tmp = self.path.with_name(self.path.name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self.data, fh, ensure_ascii=False, indent=1)
            fh.flush()
            os.fsync(fh.fileno())
        for attempt in range(5):
            try:
                os.replace(tmp, self.path)
                return
            except PermissionError:
                # Windows: antivirus or backup tools can hold the file briefly.
                if attempt == 4:
                    raise
                time.sleep(0.05 * (attempt + 1))

    def close(self):
        pass


class DirectoryTransactionLock:
    """Cross-host exclusion using atomic mkdir, with no unsafe stale-lock expiry."""

    def __init__(self, store):
        self.store = store
        self.path = store.path.with_suffix(".transaction-lock")
        self.thread_lock = threading.RLock()
        self.depth = 0

    def __enter__(self):
        self.thread_lock.acquire()
        acquired = False
        try:
            if self.depth == 0:
                deadline = time.monotonic() + 3
                while True:
                    try:
                        self.path.mkdir(mode=0o700)
                        acquired = True
                        break
                    except FileExistsError:
                        if time.monotonic() >= deadline:
                            raise TimeoutError("Storage transaction is busy; do not remove its lock while the site is running.")
                        time.sleep(0.05)
                if self.store.path.exists():
                    fresh = json.loads(self.store.path.read_text(encoding="utf-8"))
                    for key, value in fresh.items():
                        current = self.store.data.get(key)
                        if isinstance(current, dict) and isinstance(value, dict):
                            current.clear()
                            current.update(value)
                        else:
                            self.store.data[key] = value
            self.depth += 1
            return self
        except BaseException:
            if acquired:
                self.path.rmdir()
            self.thread_lock.release()
            raise

    def __exit__(self, *_):
        try:
            self.depth -= 1
            if self.depth == 0:
                self.path.rmdir()
        finally:
            self.thread_lock.release()


class LockedJSONStore(Store):
    """Atomic JSON snapshots with a fresh read inside every transaction."""

    def __init__(self, path):
        super().__init__(path)
        self.lock = DirectoryTransactionLock(self)

    def commit(self):
        with self.lock:
            super().commit()
            if os.name != "nt":
                descriptor = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)

    def close(self):
        pass


class SQLiteStore(Store):
    """A transactional SQLite snapshot for one app process and multiple threads.

    An OS lock prevents two processes from loading divergent in-memory copies.
    The original JSON file is retained after one-time migration.
    """

    def __init__(self, path):
        self._lock_file = open(path.with_suffix(".lock"), "a+b")
        try:
            if os.name == "nt":
                import msvcrt
                self._lock_file.seek(0)
                if not self._lock_file.read(1):
                    self._lock_file.write(b"0")
                    self._lock_file.flush()
                self._lock_file.seek(0)
                msvcrt.locking(self._lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as err:
            self._lock_file.close()
            raise RuntimeError("Data directory is already in use by another app process.") from err
        try:
            self.path = path
            self.lock = threading.RLock()
            self.connection = sqlite3.connect(str(path), check_same_thread=False)
            self.connection.execute("PRAGMA journal_mode=WAL")
            self.connection.execute("PRAGMA synchronous=FULL")
            self.connection.execute("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)")
            row = self.connection.execute("SELECT payload FROM app_state WHERE id = 1").fetchone()
            if row:
                self.data = json.loads(row[0])
            else:
                legacy = Store(path.with_name("db.json"))
                self.data = legacy.data
                self.commit()
        except BaseException:
            self.close()
            raise

    def commit(self):
        with self.lock, self.connection:
            self.connection.execute("INSERT INTO app_state (id,payload) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                                    (json.dumps(self.data, ensure_ascii=False, separators=(",", ":")),))

    def close(self):
        if getattr(self, "connection", None):
            self.connection.close()
            self.connection = None
        if not self._lock_file.closed:
            self._lock_file.close()


def load_session_secret(config):
    if config.session_secret:
        return config.session_secret.encode("utf-8")
    path = config.data_dir / "session.key"
    if path.exists():
        value = path.read_text(encoding="ascii").strip()
        if value:
            return value.encode("ascii")
    value = secrets.token_hex(32)
    path.write_text(value, encoding="ascii")
    return value.encode("ascii")


# ----------------------------------------------------------------- sessions --

def b64encode(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def b64decode(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class SessionSigner:
    """Stateless sign-in tokens: base64(json claims) + "." + HMAC-SHA256."""

    def __init__(self, secret, max_age):
        self.secret = secret
        self.max_age = max_age

    def _sign(self, body):
        return b64encode(hmac.new(self.secret, body.encode("ascii"), hashlib.sha256).digest())

    def issue(self, key, revision=None):
        claims = {"k": key, "exp": int(time.time()) + self.max_age}
        if revision is not None:
            claims["rev"] = revision
        body = b64encode(json.dumps(claims, separators=(",", ":")).encode("utf-8"))
        return body + "." + self._sign(body)

    def read_claims(self, token):
        try:
            body, signature = token.split(".")
            if not hmac.compare_digest(signature, self._sign(body)):
                return None
            claims = json.loads(b64decode(body))
        except (ValueError, UnicodeError):
            return None
        if not isinstance(claims, dict) or not isinstance(claims.get("exp"), int):
            return None
        if claims["exp"] < time.time() or not isinstance(claims.get("k"), str):
            return None
        return claims

    def read(self, token):
        claims = self.read_claims(token)
        return claims["k"] if claims else None


class LoginLimiter:
    """Rate-limit invalid sign-in submissions per client IP and overall."""

    def __init__(self, per_ip=10, ip_window=15 * 60, overall=100, overall_window=60 * 60):
        self.per_ip, self.ip_window = per_ip, ip_window
        self.overall, self.overall_window = overall, overall_window
        self.failures_by_ip = {}
        self.failures = deque()
        self.lock = threading.Lock()

    @staticmethod
    def _prune(queue, window, now):
        while queue and queue[0] <= now - window:
            queue.popleft()

    def retry_after(self, ip):
        now = time.monotonic()
        with self.lock:
            self._prune(self.failures, self.overall_window, now)
            if len(self.failures) >= self.overall:
                return int(self.failures[0] + self.overall_window - now) + 1
            queue = self.failures_by_ip.get(ip)
            if queue is not None:
                self._prune(queue, self.ip_window, now)
                if not queue:
                    del self.failures_by_ip[ip]
                elif len(queue) >= self.per_ip:
                    return int(queue[0] + self.ip_window - now) + 1
        return 0

    def record_failure(self, ip):
        now = time.monotonic()
        with self.lock:
            self.failures.append(now)
            self.failures_by_ip.setdefault(ip, deque()).append(now)

    def record_success(self, ip):
        with self.lock:
            self.failures_by_ip.pop(ip, None)


# --------------------------------------------------------------------- API --

class ApiError(Exception):
    def __init__(self, status, code, extra=None, headers=None):
        super().__init__(code)
        self.status, self.code = status, code
        self.extra, self.headers = extra or {}, headers or {}


class ApiRequest:
    def __init__(self, method, path, headers, body, client_ip, secure):
        self.method, self.path, self.headers = method, path, headers
        self.body, self.client_ip, self.secure = body, client_ip, secure
        self.user = None
        self.must_change_password = False

    def json(self):
        if not self.body:
            return {}
        try:
            value = json.loads(self.body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ApiError(400, "invalid_json")
        if not isinstance(value, dict):
            raise ApiError(400, "invalid_json")
        return value


ROUTES = [
    # method, path pattern, handler, sign-in required
    ("GET", r"/api/config", "get_config", False),
    ("GET", r"/api/time", "get_time", False),
    ("POST", r"/api/login", "login", False),
    ("POST", r"/api/logout", "logout", False),
    ("POST", r"/api/password", "change_password", True),
    ("GET", r"/api/me", "get_me", True),
    ("PUT", r"/api/me", "put_me", True),
    ("POST", r"/api/users", "add_users", True),
    ("GET", r"/api/users", "list_created_users", True),
    ("POST", r"/api/users/status", "set_created_user_status", True),
    ("GET", r"/api/admins", "list_admin_accounts", True),
    ("POST", r"/api/admins", "set_admin_account", True),
    ("GET", r"/api/workspaces", "list_workspaces", True),
    ("POST", r"/api/workspaces", "create_workspace", True),
    ("GET", WORKSPACE_PATH, "get_workspace", True),
    ("PATCH", WORKSPACE_PATH, "update_workspace", True),
    ("GET", INVITE_PATH, "get_invite", False),
    ("POST", INVITE_PATH + r"/join", "join_invite", True),
    ("GET", r"/api/projects", "list_projects", True),
    ("POST", r"/api/projects", "create_project", True),
    ("GET", PROJECT_PATH, "get_project", True),
    ("PATCH", PROJECT_PATH, "update_project", True),
    ("DELETE", PROJECT_PATH, "delete_project", True),
    ("PUT", PROJECT_PATH + r"/availability", "put_availability", True),
]
ROUTES = [(method, re.compile("^" + pattern + "$"), handler, auth)
          for method, pattern, handler, auth in ROUTES]


def now_ms():
    return int(time.time() * 1000)


def read_cookie(header, name):
    # Parsed by hand: http.cookies stops at the first cookie it dislikes, and
    # other apps on localhost can leave cookies it dislikes.
    for part in header.split(";"):
        key, sep, value = part.strip().partition("=")
        if sep and key == name:
            return value.strip().strip('"')
    return None


def clean_text(value, max_length, multiline=False, required=False):
    if not isinstance(value, str):
        raise ApiError(400, "invalid_text")
    value = unicodedata.normalize("NFC", value).replace("\r\n", "\n")
    value = CONTROL_CHARS.sub("", value)
    value = value.strip() if multiline else " ".join(value.split())
    if len(value) > max_length or (required and not value):
        raise ApiError(400, "invalid_text")
    return value


def clean_duration(value):
    if (not isinstance(value, int) or isinstance(value, bool)
            or not MIN_DURATION <= value <= MAX_DURATION or value % 15):
        raise ApiError(400, "invalid_duration")
    return value


def clean_member_name(value):
    if not isinstance(value, str) or CONTROL_CHARS.search(value):
        raise ApiError(400, "invalid_name")
    value = clean_name(value)
    if not value or len(value) > 80:
        raise ApiError(400, "invalid_name")
    return value


def clean_member_names(value):
    if not isinstance(value, list) or len(value) > 100:
        raise ApiError(400, "invalid_invitees")
    return [clean_member_name(name) for name in value]


def clean_color(value):
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ApiError(400, "invalid_color")
    return value.lower()


def clean_time_zone(value):
    if not isinstance(value, str) or not TIME_ZONE.match(value):
        raise ApiError(400, "invalid_time_zone")
    return value


def clean_ranges(value):
    """Weekly availability: [start, end) minute pairs counted from Monday 00:00
    in the person's own time zone. Returns them sorted and merged."""
    if not isinstance(value, list) or len(value) > 2000:
        raise ApiError(400, "invalid_ranges")
    spans = []
    for item in value:
        if not isinstance(item, list) or len(item) != 2:
            raise ApiError(400, "invalid_ranges")
        start, end = item
        if not all(isinstance(x, int) and not isinstance(x, bool) for x in (start, end)):
            raise ApiError(400, "invalid_ranges")
        if not 0 <= start < end <= WEEK_MINUTES or start % 15 or end % 15:
            raise ApiError(400, "invalid_ranges")
        spans.append((start, end))
    merged = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def dated_availability(record):
    """Anchor old repeating records to their last saved local week, once in views."""
    if "weeks" in record:
        return record
    try:
        zone = ZoneInfo(record.get("tz", "UTC"))
    except ZoneInfoNotFoundError:
        zone = datetime.timezone.utc
    day = datetime.datetime.fromtimestamp(record.get("updatedAt", 0) / 1000, zone).date()
    monday = day - datetime.timedelta(days=day.weekday())
    return {**record, "weeks": {monday.isoformat(): record.get("ranges", [])}}


def clean_weeks(value):
    if not isinstance(value, dict) or len(value) > 530:
        raise ApiError(400, "invalid_weeks")
    weeks = {}
    for key, ranges in value.items():
        try:
            day = datetime.date.fromisoformat(key)
            if day.isoformat() != key or day.weekday() != 0:
                raise ValueError()
        except (TypeError, ValueError):
            raise ApiError(400, "invalid_weeks")
        weeks[key] = clean_ranges(ranges)
    return weeks


def clean_link(value):
    """A meeting link (Zoom, Meet, Teams, ...): empty, or an http(s) URL."""
    link = clean_text(value, 500)
    if not link:
        return ""
    parts = urlsplit(link)
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc or " " in link:
        raise ApiError(400, "invalid_link")
    return link


def clean_schedule(value):
    """The confirmed meeting time: a start on the organizer's wall clock
    (date + minute of day in tz), once or every week. None clears it."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ApiError(400, "invalid_schedule")
    date, minute, repeat = value.get("date"), value.get("minute"), value.get("repeat", "none")
    try:
        if not isinstance(date, str) or not ISO_DATE.match(date):
            raise ValueError
        datetime.date.fromisoformat(date)
    except ValueError:
        raise ApiError(400, "invalid_schedule")
    if (not isinstance(minute, int) or isinstance(minute, bool)
            or not 0 <= minute < 24 * 60 or minute % 15 or repeat not in ("none", "weekly")):
        raise ApiError(400, "invalid_schedule")
    return {"tz": clean_time_zone(value.get("tz")), "date": date, "minute": minute, "repeat": repeat}


class App:
    def __init__(self, config):
        self.config = config
        config.data_dir.mkdir(parents=True, exist_ok=True)
        self.access = AccessList(config.access_users_file) if config.auth_mode == "restricted" else None
        approved = self.access.entries() if self.access else {}
        stores = {"sqlite": (SQLiteStore, "app.sqlite3"), "json": (Store, "db.json"),
                  "locked-json": (LockedJSONStore, "db.json")}
        store_type, filename = stores[config.storage]
        self.store = store_type(config.data_dir / filename)
        with self.store.lock:
            self.initialize(config, approved)

    def initialize(self, config, approved):
        self.signer = SessionSigner(load_session_secret(config), config.session_seconds)
        self.limiter = LoginLimiter()
        self.account_limiter = LoginLimiter(per_ip=5, overall=1000)
        self.store.data.setdefault("credentials", {})
        self.members_by_key = self.store.data["users"]
        # Keep configured names as initial profiles, and recover names referenced
        # by old meetings even if their original .env is no longer present.
        changed = self.store.data["version"] != 2
        initial_members = ([{"name": entry["name"], "key": key} for key, entry in approved.items()
                            if entry["enabled"]] if self.access else config.members)
        for member in initial_members:
            if member["key"] not in self.members_by_key:
                self.ensure_member(member["name"])
                changed = True
        old_keys = set(self.store.data["profiles"])
        for project in self.store.data["projects"].values():
            old_keys.update(project.get("invitees") or [])
            if project.get("createdBy"):
                old_keys.add(project["createdBy"])
        for records in self.store.data["availability"].values():
            old_keys.update(records)
        for key in sorted(old_keys):
            if key not in self.members_by_key:
                self.ensure_member(key)
                changed = True
        # Before per-meeting invitations existed, every configured profile was
        # invited. Freeze that set during migration so new name-only profiles
        # do not silently become participants in those historical meetings.
        for project in self.store.data["projects"].values():
            if project.get("invitees") is None:
                project["invitees"] = [m["key"] for m in self.members]
                changed = True
        self.store.data["version"] = 2
        if changed:
            self.store.commit()

    # -- plumbing

    @property
    def members(self):
        return sorted(self.members_by_key.values(), key=lambda m: m["index"])

    def dispatch(self, req):
        with self.store.lock:
            return self.dispatch_locked(req)

    def dispatch_locked(self, req):
        allowed = []
        for method, pattern, handler, needs_auth in ROUTES:
            match = pattern.match(req.path)
            if not match:
                continue
            if method != req.method:
                allowed.append(method)
                continue
            if needs_auth or (self.access and handler == "get_invite"):
                req.user = self.authenticate(req)
                if req.user is None:
                    raise ApiError(401, "unauthorized")
                if req.must_change_password and handler not in ("get_me", "change_password"):
                    raise ApiError(403, "password_change_required")
            return getattr(self, handler)(req, *match.groups())
        if allowed:
            raise ApiError(405, "method_not_allowed", headers={"Allow": ", ".join(allowed)})
        raise ApiError(404, "not_found")

    def authenticate(self, req):
        token = read_cookie(req.headers.get("Cookie", ""), COOKIE_NAME)
        claims = self.signer.read_claims(token) if token else None
        key = claims["k"] if claims else None
        if self.access and key:
            entry = self.access_entries().get(key)
            if not entry or not entry["enabled"] or not isinstance(claims.get("rev"), str):
                return None
            with self.store.lock:
                credential = self.effective_credential(key, entry)
                if not hmac.compare_digest(claims["rev"], self.credential_revision(entry, credential)):
                    return None
                req.must_change_password = self.config.require_password_change and credential["mustChangePassword"]
        return key if key in self.members_by_key else None

    def effective_credential(self, key, entry):
        """An owner reset invalidates the override; disabling does not erase it."""
        saved = self.store.data["credentials"].get(key)
        if saved and saved.get("approvalRevision") == entry["passwordRevision"]:
            return saved
        return {"passwordHash": entry["passwordHash"], "revision": entry["passwordRevision"],
                "mustChangePassword": True}

    @staticmethod
    def credential_revision(entry, credential):
        value = ":".join((entry["revision"], entry["passwordRevision"], credential["revision"], credential["passwordHash"]))
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def user_view(self, key, entry=None):
        user = self.member_view(key)
        user["loginName"] = user["name"]
        if self.access:
            entry = entry or self.access_entries().get(key)
            if not entry or not entry["enabled"]:
                raise ApiError(401, "unauthorized")
            user["mustChangePassword"] = self.config.require_password_change and self.effective_credential(key, entry)["mustChangePassword"]
            user["canAddUsers"] = entry.get("admin", False)
            user["canManageAdmins"] = key == self.config.owner_user_key and user["canAddUsers"]
            if user["canAddUsers"]:
                used = sum(item.get("createdBy") == key and not item.get("deletedAt") for item in self.access_entries().values())
                user["userQuota"] = {"limit": 50, "used": used, "remaining": max(0, 50 - used)}
        return user

    def access_entries(self):
        try:
            return self.access.entries()
        except AccessConfigError:
            raise ApiError(503, "access_config_error")

    def validate_approved_names(self, names):
        entries = self.access_entries() if self.access else None
        keys = []
        to_create = []
        for name in names:
            key = self.resolve_login_name(name, entries)
            if entries is not None:
                entry = entries.get(key)
                if not entry or not entry["enabled"]:
                    raise ApiError(400, "user_not_approved")
                to_create.append(entry["name"])
            elif key is None:
                if name_key(name) in self.members_by_key:
                    raise ApiError(400, "name_changed")
                key = name_key(name)
                to_create.append(name)
            keys.append(key)
        for name in to_create:
            self.ensure_member(name)
        return keys

    def resolve_login_name(self, name, entries=None):
        """Resolve the current public name to an immutable account key.

        The administrator's approval key stays fixed across user renames.
        Ambiguous names fail closed, including later approval-file edits.
        Caller holds the store lock.
        """
        target = name_key(name)
        keys = set(self.members_by_key) | set(entries or {})
        matches = []
        for key in keys:
            profile = self.store.data["profiles"].get(key) or {}
            original = self.members_by_key.get(key) or (entries or {}).get(key)
            current = profile.get("displayName") or original["name"]
            if name_key(current) == target:
                matches.append(key)
        return matches[0] if len(matches) == 1 else None

    def session_cookie(self, value, max_age, secure):
        cookie = f"{COOKIE_NAME}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax"
        return cookie + "; Secure" if secure else cookie

    def member_view(self, key):
        member = self.members_by_key[key]
        profile = self.store.data["profiles"].get(key) or {}
        return {"key": key, "name": profile.get("displayName") or member["name"],
                "index": member["index"], "tz": profile.get("tz")}

    def ensure_member(self, name):
        """Caller holds the store lock and has validated the display name."""
        key = name_key(name)
        if key not in self.members_by_key:
            index = max((m["index"] for m in self.members), default=-1) + 1
            member = {"key": key, "name": name, "index": index}
            self.members_by_key[key] = member
        return key

    def invitees(self, project):
        keys = project.get("invitees", [])
        return [k for k in keys if k in self.members_by_key]

    def clean_invitees(self, value, owner, workspace=None):
        if not isinstance(value, list) or len(value) > 500:
            raise ApiError(400, "invalid_invitees")
        keys = [owner]
        approved = self.access_entries() if self.access else None
        for key in value:
            if not isinstance(key, str):
                raise ApiError(400, "invalid_invitees")
            if workspace is not None and key not in workspace["members"]:
                raise ApiError(400, "invitee_not_in_workspace")
            if approved is not None and (key not in approved or not approved[key]["enabled"]):
                raise ApiError(400, "user_not_approved")
            if key in self.members_by_key and key not in keys:
                keys.append(key)
        return keys

    def project_view(self, project):
        invitees = self.invitees(project)
        saved = self.store.data["availability"].get(project["id"], {})
        return {**project, "invitees": invitees, "filled": [k for k in invitees if k in saved]}

    def find_project(self, project_id, user):
        """Only invitees know a meeting exists; everyone else gets a 404."""
        project = self.store.data["projects"].get(project_id)
        if project is None or user not in self.invitees(project):
            raise ApiError(404, "project_not_found")
        if project.get("workspaceId"):
            self.find_workspace(project["workspaceId"], user)
        return project

    # -- sign-in

    def get_config(self, req):
        return 200, {"authMode": self.config.auth_mode, "hosting": self.config.hosting}

    def get_time(self, req):
        # Both representations come from one clock sample. The browser chooses
        # the calendar date in its selected time zone, not the server's zone.
        milliseconds = now_ms()
        utc = datetime.datetime.fromtimestamp(milliseconds / 1000, datetime.timezone.utc)
        return 200, {"unixMs": milliseconds, "utc": utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")}

    def login(self, req):
        with self.store.lock:
            return self.login_locked(req)

    def login_locked(self, req):
        wait = self.limiter.retry_after(req.client_ip)
        if wait:
            raise ApiError(429, "rate_limited", {"retryAfter": wait}, {"Retry-After": str(wait)})
        try:
            body = req.json()
            name = clean_member_name(body.get("name"))
            revision = None
            entry = None
            if self.access:
                if self.config.require_https and not req.secure:
                    raise ApiError(403, "https_required")
                entries = self.access_entries()
                key = self.resolve_login_name(name, entries)
                limit_key = key or name_key(name)
                wait = self.account_limiter.retry_after(limit_key)
                if wait:
                    raise ApiError(429, "rate_limited", {"retryAfter": wait}, {"Retry-After": str(wait)})
                entry = entries.get(key)
                with self.store.lock:
                    credential = self.effective_credential(key, entry) if entry else None
                encoded = credential["passwordHash"] if credential else DUMMY_HASH
                valid = verify_password(body.get("password"), encoded)
                if not valid or not entry or not entry["enabled"]:
                    self.account_limiter.record_failure(limit_key)
                    raise ApiError(403, "access_denied")
                name = entry["name"]
                revision = self.credential_revision(entry, credential)
                self.account_limiter.record_success(key)
        except ApiError:
            self.limiter.record_failure(req.client_ip)
            raise
        self.limiter.record_success(req.client_ip)
        with self.store.lock:
            if self.access:
                key = self.ensure_member(name)
            else:
                key = self.resolve_login_name(name)
                if key is None:
                    if name_key(name) in self.members_by_key:
                        raise ApiError(403, "name_changed")
                    key = self.ensure_member(name)
            self.store.commit()
            user = self.user_view(key, entry)
        cookie = self.session_cookie(self.signer.issue(key, revision), self.signer.max_age, req.secure)
        return 200, {"user": user}, {"Set-Cookie": cookie}

    def logout(self, req):
        return 200, {"ok": True}, {"Set-Cookie": self.session_cookie("", 0, req.secure)}

    def change_password(self, req):
        if not self.access:
            raise ApiError(400, "password_not_required")
        if self.config.require_https and not req.secure:
            raise ApiError(403, "https_required")
        wait = max(self.limiter.retry_after(req.client_ip), self.account_limiter.retry_after(req.user))
        if wait:
            raise ApiError(429, "rate_limited", {"retryAfter": wait}, {"Retry-After": str(wait)})
        body = req.json()
        current, new = body.get("currentPassword"), body.get("newPassword")
        if not valid_password(new):
            raise ApiError(400, "invalid_password")
        if new == DEFAULT_PASSWORD:
            raise ApiError(400, "default_password_not_allowed")
        entry = self.access_entries().get(req.user)
        if not entry or not entry["enabled"]:
            raise ApiError(401, "unauthorized")
        with self.store.lock:
            credential = self.effective_credential(req.user, entry)
            if not verify_password(current, credential["passwordHash"]):
                self.limiter.record_failure(req.client_ip)
                self.account_limiter.record_failure(req.user)
                raise ApiError(403, "incorrect_password")
            if current == new:
                raise ApiError(400, "password_unchanged")
            # The service can change an existing user's password in SQLite,
            # but it never writes to the server owner's approval file.
            credential = {"approvalRevision": entry["passwordRevision"], "passwordHash": hash_password(new),
                          "revision": secrets.token_urlsafe(24), "mustChangePassword": False}
            self.store.data["credentials"][req.user] = credential
            self.store.commit()
            user = self.user_view(req.user, entry)
            revision = self.credential_revision(entry, credential)
        self.limiter.record_success(req.client_ip)
        self.account_limiter.record_success(req.user)
        cookie = self.session_cookie(self.signer.issue(req.user, revision), self.signer.max_age, req.secure)
        return 200, {"user": user}, {"Set-Cookie": cookie}

    def get_me(self, req):
        approved = self.access_entries() if self.access else None
        with self.store.lock:
            user = self.user_view(req.user, approved.get(req.user) if approved is not None else None)
            if user.get("mustChangePassword"):
                return 200, {"user": user, "members": []}
            if approved is not None:
                before = len(self.members)
                for entry in approved.values():
                    if entry["enabled"]:
                        self.ensure_member(entry["name"])
                if len(self.members) != before:
                    self.store.commit()
            return 200, {
                "user": user,
                "members": [self.member_view(m["key"]) for m in self.members
                            if approved is None or (m["key"] in approved and approved[m["key"]]["enabled"])],
            }

    def put_me(self, req):
        body = req.json()
        changes = {}
        if "tz" in body:
            changes["tz"] = clean_time_zone(body["tz"])
        if "displayName" in body:
            try:
                changes["displayName"] = normalized_name(body["displayName"])
            except AccessConfigError:
                raise ApiError(400, "invalid_name")
        if not changes:
            raise ApiError(400, "invalid_profile")
        with self.store.lock:
            if "displayName" in changes:
                wanted = name_key(changes["displayName"])
                entries = self.access_entries() if self.access else {}
                for key in set(self.members_by_key) | set(entries):
                    if key == req.user:
                        continue
                    member = self.members_by_key.get(key) or entries[key]
                    profile = self.store.data["profiles"].get(key) or {}
                    if wanted in (key, name_key(member["name"]), name_key(profile.get("displayName") or member["name"])):
                        raise ApiError(409, "name_in_use")
            profile = self.store.data["profiles"].get(req.user) or {}
            self.store.data["profiles"][req.user] = {**profile, **changes, "updatedAt": now_ms()}
            self.store.commit()
            return 200, {"user": self.user_view(req.user)}

    def add_users(self, req):
        if not self.access:
            raise ApiError(403, "admin_required")
        body = req.json()
        names = clean_member_names(body.get("names"))
        if not names or len(names) > 20:
            raise ApiError(400, "invalid_names")
        with self.store.lock:
            document = load_document(self.config.access_users_file)
            entries = {name_key(entry["name"]): entry for entry in document["users"]}
            actor = entries.get(req.user)
            if not actor or not actor["enabled"] or not actor.get("admin", False):
                raise ApiError(403, "admin_required")
            seen = set(entries) | set(self.members_by_key)
            seen.update(name_key(self.member_view(key)["name"]) for key in self.members_by_key)
            for name in names:
                key = name_key(name)
                if key in seen:
                    raise ApiError(409, "name_in_use")
                seen.add(key)
            remaining = max(0, self.config.max_users - sum(not item.get("deletedAt") for item in entries.values()))
            quota_remaining = max(0, 50 - sum(item.get("createdBy") == req.user and not item.get("deletedAt") for item in entries.values()))
            if len(names) > quota_remaining:
                raise ApiError(409, "admin_quota_reached", {"limit": 50, "remaining": quota_remaining})
            if self.config.max_users and len(names) > remaining:
                raise ApiError(409, "user_limit_reached", {"limit": self.config.max_users, "remaining": remaining})
            for name in names:
                document["users"].append({"name": name, "enabled": True,
                    "admin": body.get("admin") is True and req.user == self.config.owner_user_key,
                    "createdBy": req.user, "createdAt": now_ms(),
                    "passwordHash": hash_password(DEFAULT_PASSWORD),
                    "passwordRevision": secrets.token_urlsafe(24), "revision": secrets.token_urlsafe(24)})
            try:
                write_document(self.config.access_users_file, document)
            except OSError as err:
                if err.errno in (errno.ENOSPC, getattr(errno, "EDQUOT", errno.ENOSPC)):
                    raise ApiError(507, "storage_full") from err
                raise
            # Membership is materialized by get_me/login; approval remains durable
            # even if this process stops immediately after the atomic file update.
            return 201, {"names": names, "defaultPassword": DEFAULT_PASSWORD}

    def owned_users_document(self, req):
        if not self.access:
            raise ApiError(403, "admin_required")
        document = load_document(self.config.access_users_file)
        actor = next((item for item in document["users"] if name_key(item["name"]) == req.user), None)
        if not actor or not actor["enabled"] or not actor.get("admin"):
            raise ApiError(403, "admin_required")
        return document

    def list_created_users(self, req):
        document = self.owned_users_document(req)
        users = []
        for item in document["users"]:
            if item.get("createdBy") != req.user:
                continue
            key = name_key(item["name"])
            profile = self.store.data["profiles"].get(key) or {}
            users.append({"key": key, "name": profile.get("displayName") or item["name"],
                "enabled": item["enabled"], "deleted": bool(item.get("deletedAt")),
                "createdAt": item.get("createdAt"), "canManage": not item.get("admin", False)})
        used = sum(not item["deleted"] for item in users)
        return 200, {"users": users, "quota": {"limit": 50, "used": used, "remaining": max(0, 50-used)}}

    def set_created_user_status(self, req):
        body = req.json()
        if not isinstance(body.get("key"), str) or type(body.get("deleted")) is not bool:
            raise ApiError(400, "invalid_user_status")
        document = self.owned_users_document(req)
        target = next((item for item in document["users"] if name_key(item["name"]) == body["key"]), None)
        if not target or target.get("createdBy") != req.user or target.get("admin") or body["key"] == req.user:
            raise ApiError(403, "user_not_owned")
        deleting = body["deleted"]
        if bool(target.get("deletedAt")) == deleting:
            return self.list_created_users(req)
        if not deleting:
            used = sum(item.get("createdBy") == req.user and not item.get("deletedAt") for item in document["users"])
            if used >= 50:
                raise ApiError(409, "admin_quota_reached", {"limit": 50, "remaining": 0})
            count = sum(not item.get("deletedAt") for item in document["users"])
            if self.config.max_users and count >= self.config.max_users:
                raise ApiError(409, "user_limit_reached", {"limit": self.config.max_users, "remaining": 0})
        target["enabled"] = not deleting
        # Rotation prevents a deleted session from working again after restore.
        target["revision"] = secrets.token_urlsafe(24)
        if deleting:
            target["deletedAt"] = now_ms()
        else:
            target.pop("deletedAt", None)
        write_document(self.config.access_users_file, document)
        return self.list_created_users(req)

    def owner_document(self, req):
        document = self.owned_users_document(req)
        if req.user != self.config.owner_user_key:
            raise ApiError(403, "owner_required")
        return document

    def list_admin_accounts(self, req):
        document = self.owner_document(req)
        users = []
        for item in document["users"]:
            if not item["enabled"] or item.get("deletedAt"):
                continue
            key = name_key(item["name"])
            profile = self.store.data["profiles"].get(key) or {}
            users.append({"key":key, "name":profile.get("displayName") or item["name"],
                "admin":bool(item.get("admin")), "owner": key == self.config.owner_user_key})
        return 200, {"users":users}

    def set_admin_account(self, req):
        body = req.json()
        document = self.owner_document(req)
        if not isinstance(body.get("key"), str) or type(body.get("admin")) is not bool:
            raise ApiError(400, "invalid_user_status")
        target = next((item for item in document["users"] if name_key(item["name"]) == body["key"]), None)
        if not target or not target["enabled"] or target.get("deletedAt"):
            raise ApiError(404, "user_not_found")
        if body["key"] == self.config.owner_user_key:
            raise ApiError(403, "owner_protected")
        target["admin"] = body["admin"]
        write_document(self.config.access_users_file, document)
        return self.list_admin_accounts(req)

    # -- workspaces: projects containing meetings and shared membership

    def find_workspace(self, workspace_id, user):
        if not isinstance(workspace_id, str):
            raise ApiError(400, "invalid_workspace")
        workspace = self.store.data["workspaces"].get(workspace_id)
        if workspace is None or user not in workspace["members"]:
            raise ApiError(404, "workspace_not_found")
        return workspace

    def workspace_view(self, workspace, user):
        meeting_count = sum(1 for project in self.store.data["projects"].values()
                            if project.get("workspaceId") == workspace["id"]
                            and user in self.invitees(project))
        return {**workspace, "meetingCount": meeting_count}

    def list_workspaces(self, req):
        with self.store.lock:
            workspaces = [self.workspace_view(w, req.user)
                          for w in self.store.data["workspaces"].values()
                          if req.user in w["members"]]
        workspaces.sort(key=lambda w: w["updatedAt"], reverse=True)
        return 200, {"workspaces": workspaces}

    def create_workspace(self, req):
        body = req.json()
        workspace = {
            "title": clean_text(body.get("title"), 80, required=True),
            "description": clean_text(body.get("description", ""), 500, multiline=True),
            "color": clean_color(body.get("color", "#6366f1")),
            "owner": req.user,
            "members": [req.user],
            "inviteCode": secrets.token_urlsafe(18),
            "createdAt": now_ms(),
        }
        names = clean_member_names(body.get("inviteNames", []))
        with self.store.lock:
            invited_keys = self.validate_approved_names(names)
            workspace_id = secrets.token_urlsafe(6)
            while workspace_id in self.store.data["workspaces"]:
                workspace_id = secrets.token_urlsafe(6)
            workspace.update(id=workspace_id, updatedAt=workspace["createdAt"])
            for key in invited_keys:
                if key not in workspace["members"]:
                    workspace["members"].append(key)
            self.store.data["workspaces"][workspace_id] = workspace
            self.store.commit()
            return 201, {"workspace": self.workspace_view(workspace, req.user)}

    def get_workspace(self, req, workspace_id):
        with self.store.lock:
            workspace = self.find_workspace(workspace_id, req.user)
            meetings = [self.project_view(p) for p in self.store.data["projects"].values()
                        if p.get("workspaceId") == workspace_id and req.user in self.invitees(p)]
            meetings.sort(key=lambda p: p["updatedAt"], reverse=True)
            return 200, {"workspace": self.workspace_view(workspace, req.user),
                         "meetings": meetings,
                         "members": [self.member_view(k) for k in workspace["members"]]}

    def update_workspace(self, req, workspace_id):
        body = req.json()
        with self.store.lock:
            workspace = self.find_workspace(workspace_id, req.user)
            if any(field in body for field in ("title", "description", "color")):
                if workspace["owner"] != req.user:
                    raise ApiError(403, "not_owner")
            changes = {}
            if "title" in body:
                changes["title"] = clean_text(body["title"], 80, required=True)
            if "description" in body:
                changes["description"] = clean_text(body["description"], 500, multiline=True)
            if "color" in body:
                changes["color"] = clean_color(body["color"])
            names = clean_member_names(body.get("inviteNames", []))
            names += clean_member_names(body.get("memberNames", []))
            for key in self.validate_approved_names(names):
                if key not in workspace["members"]:
                    workspace["members"].append(key)
            workspace.update(changes, updatedAt=now_ms())
            self.store.commit()
            return 200, {"workspace": self.workspace_view(workspace, req.user)}

    def find_invite(self, code):
        for workspace in self.store.data["workspaces"].values():
            if hmac.compare_digest(workspace["inviteCode"], code):
                return workspace
        raise ApiError(404, "invite_not_found")

    def get_invite(self, req, code):
        with self.store.lock:
            workspace = self.find_invite(code)
            return 200, {"workspace": {key: workspace[key] for key in ("id", "title", "description")},
                         "memberCount": len(workspace["members"])}

    def join_invite(self, req, code):
        with self.store.lock:
            workspace = self.find_invite(code)
            if req.user not in workspace["members"]:
                workspace["members"].append(req.user)
                workspace["updatedAt"] = now_ms()
                self.store.commit()
            return 200, {"workspace": self.workspace_view(workspace, req.user)}

    # -- projects API: retained name for compatibility; each record is a meeting

    def list_projects(self, req):
        with self.store.lock:
            projects = [self.project_view(p) for p in self.store.data["projects"].values()
                        if req.user in self.invitees(p)]
        projects.sort(key=lambda p: p["updatedAt"], reverse=True)
        return 200, {"projects": projects}

    def create_project(self, req):
        body = req.json()
        project = {
            "title": clean_text(body.get("title"), 80, required=True),
            "description": clean_text(body.get("description", ""), 500, multiline=True),
            "duration": clean_duration(body.get("duration", 60)),
            "link": clean_link(body.get("link", "")),
            "schedule": None,
            "createdBy": req.user,
            "createdAt": now_ms(),
        }
        project["updatedAt"] = project["createdAt"]
        with self.store.lock:
            workspace = None
            if body.get("workspaceId") is not None:
                workspace = self.find_workspace(body["workspaceId"], req.user)
                project["workspaceId"] = workspace["id"]
            defaults = workspace["members"] if workspace else [m["key"] for m in self.members]
            if self.access:
                approved = self.access_entries()
                defaults = [key for key in defaults if key in approved and approved[key]["enabled"]]
            project["invitees"] = self.clean_invitees(body.get("invitees", defaults), req.user, workspace)
            project_id = secrets.token_urlsafe(6)
            while project_id in self.store.data["projects"]:
                project_id = secrets.token_urlsafe(6)
            project = {"id": project_id, **project}
            self.store.data["projects"][project_id] = project
            if workspace:
                workspace["updatedAt"] = project["updatedAt"]
            self.store.commit()
            return 201, {"project": self.project_view(project)}

    def get_project(self, req, project_id):
        with self.store.lock:
            project = self.find_project(project_id, req.user)
            invitees = self.invitees(project)
            availability = {k: dated_availability(v) for k, v in self.store.data["availability"].get(project_id, {}).items()
                            if k in invitees}
            return 200, {"project": self.project_view(project), "availability": availability,
                         "members": [self.member_view(k) for k in invitees]}

    def update_project(self, req, project_id):
        """Any invitee may adjust a meeting; only its creator may delete it."""
        body = req.json()
        with self.store.lock:
            project = self.find_project(project_id, req.user)
            changes = {}
            if "title" in body:
                changes["title"] = clean_text(body["title"], 80, required=True)
            if "description" in body:
                changes["description"] = clean_text(body["description"], 500, multiline=True)
            if "duration" in body:
                changes["duration"] = clean_duration(body["duration"])
            if "invitees" in body:
                workspace = (self.find_workspace(project["workspaceId"], req.user)
                             if project.get("workspaceId") else None)
                changes["invitees"] = self.clean_invitees(body["invitees"], project["createdBy"], workspace)
            if "link" in body:
                changes["link"] = clean_link(body["link"])
            if "schedule" in body:
                changes["schedule"] = clean_schedule(body["schedule"])
            project.update(changes, updatedAt=now_ms())
            self.store.commit()
            return 200, {"project": self.project_view(project)}

    def delete_project(self, req, project_id):
        with self.store.lock:
            project = self.find_project(project_id, req.user)
            if project["createdBy"] != req.user:
                raise ApiError(403, "not_owner")
            del self.store.data["projects"][project_id]
            self.store.data["availability"].pop(project_id, None)
            self.store.commit()
            return 200, {"ok": True}

    def put_availability(self, req, project_id):
        body = req.json()
        record = {
            "tz": clean_time_zone(body.get("tz")),
            "updatedAt": now_ms(),
        }
        dated = "weeks" in body
        record["weeks" if dated else "ranges"] = clean_weeks(body["weeks"]) if dated else clean_ranges(body.get("ranges"))
        with self.store.lock:
            project = self.find_project(project_id, req.user)
            previous = self.store.data["availability"].get(project_id, {}).get(req.user)
            if dated:
                if body.get("baseUpdatedAt") != (previous.get("updatedAt") if previous else None):
                    raise ApiError(409, "availability_conflict")
                record["updatedAt"] = max(record["updatedAt"], (previous or {}).get("updatedAt", 0) + 1)
            elif previous and "weeks" in previous:
                raise ApiError(409, "availability_conflict")
            self.store.data["availability"].setdefault(project_id, {})[req.user] = record
            project["updatedAt"] = record["updatedAt"]
            self.store.commit()
            return 200, {"availability": record}


# -------------------------------------------------------------------- HTTP --

class Handler(BaseHTTPRequestHandler):
    server_version = "TripartitionedWorld"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        self.route()

    def do_HEAD(self):
        self.route()

    def do_POST(self):
        self.route()

    def do_PUT(self):
        self.route()

    def do_PATCH(self):
        self.route()

    def do_DELETE(self):
        self.route()

    @property
    def app(self):
        return self.server.app

    def route(self):
        self.headers_sent = False
        try:
            path = urlsplit(self.path).path
            if path == "/api" or path.startswith("/api/"):
                self.handle_api(path)
            elif self.command in ("GET", "HEAD"):
                self.handle_static(path)
            else:
                self.send_json(405, {"error": "method_not_allowed"})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception:
            traceback.print_exc()
            if not self.headers_sent:
                self.send_json(500, {"error": "server_error"})

    # -- request details

    def client_ip(self):
        if self.app.config.trust_proxy:
            for header in ("CF-Connecting-IP", "X-Real-IP"):
                if self.headers.get(header):
                    return self.headers[header].strip()
            forwarded = self.headers.get("X-Forwarded-For")
            if forwarded:
                return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def is_https(self):
        return (self.app.config.trust_proxy
                and self.headers.get("X-Forwarded-Proto", "").lower() == "https")

    def same_origin(self):
        """Reject cross-site writes. Browsers send Origin on every POST/PUT/
        PATCH/DELETE; requests without one are not from a web page."""
        origin = self.headers.get("Origin")
        if not origin:
            return True
        hosts = {self.headers.get("Host", "")}
        if self.app.config.trust_proxy and self.headers.get("X-Forwarded-Host"):
            hosts.add(self.headers["X-Forwarded-Host"].split(",")[0].strip())
        return urlsplit(origin).netloc in hosts

    def read_body(self):
        length = self.headers.get("Content-Length")
        if not length:
            return b""
        try:
            size = int(length)
        except ValueError:
            size = -1
        if size < 0 or size > MAX_BODY_BYTES:
            self.close_connection = True  # the unread body would garble the next request
            raise ApiError(413 if size > 0 else 400, "bad_body")
        return self.rfile.read(size)

    # -- handlers

    def handle_api(self, path):
        try:
            body = self.read_body()
            if self.command not in ("GET", "HEAD"):
                if not self.same_origin():
                    raise ApiError(403, "cross_origin")
                content_type = self.headers.get("Content-Type", "")
                if body and not content_type.lower().startswith("application/json"):
                    raise ApiError(415, "json_required")
            req = ApiRequest(self.command, path, self.headers, body, self.client_ip(), self.is_https())
            result = self.app.dispatch(req)
            status, payload = result[0], result[1]
            headers = result[2] if len(result) > 2 else {}
        except ApiError as err:
            status, payload, headers = err.status, {"error": err.code, **err.extra}, err.headers
        self.send_json(status, payload, headers)

    def handle_static(self, path):
        rel = unquote(path)
        if rel in ("", "/"):
            rel = "/index.html"
        if "\x00" in rel:
            return self.send_text(400, "Bad request")
        target = (PUBLIC_DIR / rel.lstrip("/")).resolve()
        try:
            target.relative_to(PUBLIC_DIR)
        except ValueError:
            return self.send_text(404, "Not found")
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            return self.send_text(404, "Not found")
        stat = target.stat()
        etag = '"%x-%x"' % (stat.st_mtime_ns, stat.st_size)
        content_type = MIME_TYPES.get(target.suffix.lower(), "application/octet-stream")
        headers = {"ETag": etag, "Cache-Control": "no-cache"}
        if content_type.startswith("text/html"):
            headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
        if self.headers.get("If-None-Match") == etag:
            return self.send_bytes(304, b"", None, headers)
        self.send_bytes(200, target.read_bytes(), content_type, headers)

    # -- responses

    def send_bytes(self, status, body, content_type=None, headers=None):
        self.send_response(status)
        if content_type:
            self.send_header("Content-Type", content_type)
        if status != 304:
            self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.headers_sent = True
        if self.command != "HEAD" and status != 304:
            self.wfile.write(body)

    def send_json(self, status, payload, headers=None):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_bytes(status, body, "application/json; charset=utf-8",
                        {"Cache-Control": "no-store", **(headers or {})})

    def send_text(self, status, text):
        self.send_bytes(status, text.encode("utf-8"), "text/plain; charset=utf-8")

    def log_request(self, code="-", size="-"):
        # Log API calls and errors; skip the stream of static-file hits.
        status = int(code) if isinstance(code, int) else 0
        path = urlsplit(self.path).path
        if path.startswith("/api/") or status >= 400:
            self.log_message("%s %s -> %s", self.command, path, status or code)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s  %s\n" % (time.strftime("%H:%M:%S"), fmt % args))


# -------------------------------------------------------------------- main --

def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="The Tripartitioned World - projects and meetings across time zones.")
    parser.add_argument("--host", help="listen address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, help="port (default 8000)")
    parser.add_argument("--env-file", default=str(ROOT / ".env"), help="settings file (default ./.env)")
    parser.add_argument("--data-dir", help="where to keep db.json (default ./data)")
    parser.add_argument("--open", action="store_true", help="open the app in your browser")
    return parser.parse_args(argv)


def build_server(args):
    config = Config(args)
    server = ThreadingHTTPServer((config.host, config.port), Handler)
    server.daemon_threads = True
    server.app = App(config)
    return server


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    args = parse_args(argv)
    server = build_server(args)
    config = server.app.config
    host = config.host if config.host not in ("127.0.0.1", "0.0.0.0", "::", "") else "localhost"
    url = f"http://{host}:{server.server_address[1]}"
    print(f"The Tripartitioned World is running at {url}")
    print(f"  local profiles: {len(server.app.members)}   data: {config.data_dir}")
    print("  Enter any name to get started. No .env or registration is required.")
    print("  Press Ctrl+C to stop.")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
        server.app.store.close()


if __name__ == "__main__":
    main()
