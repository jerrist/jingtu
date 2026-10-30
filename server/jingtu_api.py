#!/usr/bin/env python3
"""Jingtu account and learning-progress sync API.

Uses only Python's standard library so it can run on the existing Ubuntu host.
The service binds to loopback and is exposed only through Nginx.
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


DB_PATH = os.environ.get("JINGTU_DB_PATH", "/var/lib/jingtu/jingtu.db")
ORIGIN = os.environ.get("JINGTU_ORIGIN", "https://exam.jerrists.cloud")
HOST = os.environ.get("JINGTU_HOST", "127.0.0.1")
PORT = int(os.environ.get("JINGTU_PORT", "3100"))
SESSION_TTL = 30 * 24 * 60 * 60
MAX_BODY = 1024 * 1024
USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-\u4e00-\u9fff]{3,24}$")
RATE_BUCKETS = {}


def now():
    return int(time.time())


def db():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), mode=0o750, exist_ok=True)
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS progress (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                revision INTEGER NOT NULL DEFAULT 0,
                state_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            """
        )
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now(),))


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310000)
    return salt.hex(), digest.hex()


def verify_password(password, salt_hex, expected_hex):
    _, actual = hash_password(password, bytes.fromhex(salt_hex))
    return hmac.compare_digest(actual, expected_hex)


def token_digest(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def rate_allowed(key, limit=10, window=300):
    cutoff = now() - window
    attempts = [stamp for stamp in RATE_BUCKETS.get(key, []) if stamp > cutoff]
    if len(attempts) >= limit:
        RATE_BUCKETS[key] = attempts
        return False
    attempts.append(now())
    RATE_BUCKETS[key] = attempts
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = "JingtuSync/1.0"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (extra_headers or []):
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("请求长度无效")
        if size <= 0 or size > MAX_BODY:
            raise ValueError("请求内容为空或过大")
        try:
            value = json.loads(self.rfile.read(size).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("JSON 格式无效")
        if not isinstance(value, dict):
            raise ValueError("请求内容必须是对象")
        return value

    def mutation_origin_ok(self):
        origin = self.headers.get("Origin")
        return origin is None or origin == ORIGIN

    def current_user(self):
        header = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie()
        try:
            jar.load(header)
            token = jar.get("jingtu_session").value if jar.get("jingtu_session") else None
        except cookies.CookieError:
            token = None
        if not token:
            return None
        with db() as connection:
            row = connection.execute(
                """SELECT users.id, users.username
                   FROM sessions JOIN users ON users.id = sessions.user_id
                   WHERE sessions.token_hash = ? AND sessions.expires_at > ?""",
                (token_digest(token), now()),
            ).fetchone()
        return dict(row) if row else None

    def require_user(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {"error": "请先登录"})
        return user

    def session_cookie(self, token, max_age=SESSION_TTL):
        value = (
            "jingtu_session=%s; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=%d"
            % (token, max_age)
        )
        return ("Set-Cookie", value)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self.send_json(200, {"ok": True, "service": "jingtu-sync"})
        if path == "/api/me":
            user = self.current_user()
            return self.send_json(200, {"user": user})
        if path == "/api/progress":
            user = self.require_user()
            if not user:
                return
            with db() as connection:
                row = connection.execute(
                    "SELECT revision, state_json, updated_at FROM progress WHERE user_id = ?",
                    (user["id"],),
                ).fetchone()
            if not row:
                return self.send_json(200, {"revision": 0, "state": None, "updatedAt": None})
            return self.send_json(
                200,
                {
                    "revision": row["revision"],
                    "state": json.loads(row["state_json"]),
                    "updatedAt": row["updated_at"],
                },
            )
        self.send_json(404, {"error": "接口不存在"})

    def do_POST(self):
        if not self.mutation_origin_ok():
            return self.send_json(403, {"error": "请求来源不受信任"})
        path = urlparse(self.path).path
        try:
            payload = self.read_json()
        except ValueError as error:
            return self.send_json(400, {"error": str(error)})

        if path in ("/api/auth/register", "/api/auth/login"):
            ip = self.headers.get("X-Real-IP", self.client_address[0])
            if not rate_allowed("%s:%s" % (path, ip)):
                return self.send_json(429, {"error": "尝试次数过多，请稍后再试"})
            username = str(payload.get("username", "")).strip()
            password = str(payload.get("password", ""))
            if not USERNAME_RE.fullmatch(username):
                return self.send_json(400, {"error": "账号需为 3–24 位中文、字母、数字、横线或下划线"})
            if len(password) < 8 or len(password) > 128:
                return self.send_json(400, {"error": "密码长度需为 8–128 位"})

            if path.endswith("register"):
                salt, digest = hash_password(password)
                try:
                    with db() as connection:
                        cursor = connection.execute(
                            "INSERT INTO users(username,password_salt,password_hash,created_at) VALUES(?,?,?,?)",
                            (username, salt, digest, now()),
                        )
                        user_id = cursor.lastrowid
                except sqlite3.IntegrityError:
                    return self.send_json(409, {"error": "账号已存在"})
            else:
                with db() as connection:
                    row = connection.execute(
                        "SELECT id, username, password_salt, password_hash FROM users WHERE username = ?",
                        (username,),
                    ).fetchone()
                if not row or not verify_password(password, row["password_salt"], row["password_hash"]):
                    return self.send_json(401, {"error": "账号或密码错误"})
                user_id = row["id"]
                username = row["username"]

            token = secrets.token_urlsafe(32)
            with db() as connection:
                connection.execute(
                    "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
                    (token_digest(token), user_id, now() + SESSION_TTL, now()),
                )
            return self.send_json(
                200,
                {"user": {"id": user_id, "username": username}},
                [self.session_cookie(token)],
            )

        if path == "/api/auth/logout":
            header = self.headers.get("Cookie", "")
            jar = cookies.SimpleCookie()
            try:
                jar.load(header)
                token = jar.get("jingtu_session").value if jar.get("jingtu_session") else None
            except cookies.CookieError:
                token = None
            if token:
                with db() as connection:
                    connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(token),))
            return self.send_json(200, {"ok": True}, [self.session_cookie("deleted", 0)])

        self.send_json(404, {"error": "接口不存在"})

    def do_PUT(self):
        if not self.mutation_origin_ok():
            return self.send_json(403, {"error": "请求来源不受信任"})
        if urlparse(self.path).path != "/api/progress":
            return self.send_json(404, {"error": "接口不存在"})
        user = self.require_user()
        if not user:
            return
        try:
            payload = self.read_json()
        except ValueError as error:
            return self.send_json(400, {"error": str(error)})
        state = payload.get("state")
        base_revision = payload.get("baseRevision")
        if not isinstance(state, dict) or not isinstance(base_revision, int):
            return self.send_json(400, {"error": "同步数据格式无效"})
        state_json = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        if len(state_json.encode("utf-8")) > 512 * 1024:
            return self.send_json(413, {"error": "学习数据过大"})

        with db() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT revision, state_json, updated_at FROM progress WHERE user_id = ?",
                (user["id"],),
            ).fetchone()
            current_revision = row["revision"] if row else 0
            if current_revision != base_revision:
                connection.rollback()
                return self.send_json(
                    409,
                    {
                        "error": "数据已在其他设备更新",
                        "revision": current_revision,
                        "state": json.loads(row["state_json"]) if row else None,
                        "updatedAt": row["updated_at"] if row else None,
                    },
                )
            revision = current_revision + 1
            updated_at = now()
            connection.execute(
                """INSERT INTO progress(user_id,revision,state_json,updated_at)
                   VALUES(?,?,?,?)
                   ON CONFLICT(user_id) DO UPDATE SET
                     revision=excluded.revision,
                     state_json=excluded.state_json,
                     updated_at=excluded.updated_at""",
                (user["id"], revision, state_json, updated_at),
            )
            connection.commit()
        self.send_json(200, {"revision": revision, "updatedAt": updated_at})


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("Jingtu sync API listening on %s:%d" % (HOST, PORT), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
