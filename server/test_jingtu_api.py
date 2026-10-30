#!/usr/bin/env python3
import http.client
import json
import os
import subprocess
import tempfile
import time


def request(method, path, payload=None, cookie=None):
    connection = http.client.HTTPConnection("127.0.0.1", 3101, timeout=3)
    headers = {"Origin": "https://exam.jerrists.cloud"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload)
    else:
        body = None
    if cookie:
        headers["Cookie"] = cookie
    connection.request(method, path, body=body, headers=headers)
    response = connection.getresponse()
    data = json.loads(response.read().decode("utf-8"))
    set_cookie = response.getheader("Set-Cookie")
    connection.close()
    return response.status, data, set_cookie


with tempfile.TemporaryDirectory() as directory:
    environment = dict(os.environ)
    environment.update({
        "JINGTU_DB_PATH": os.path.join(directory, "test.db"),
        "JINGTU_PORT": "3101",
        "JINGTU_ORIGIN": "https://exam.jerrists.cloud",
    })
    process = subprocess.Popen(["python3", os.path.join(os.path.dirname(__file__), "jingtu_api.py")], env=environment)
    try:
        for _ in range(30):
            try:
                status, data, _ = request("GET", "/api/health")
                if status == 200 and data.get("ok"):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise AssertionError("API did not start")

        status, data, header = request("POST", "/api/auth/register", {"username": "smoketest", "password": "safe-test-password"})
        assert status == 200, (status, data)
        cookie = header.split(";", 1)[0]
        status, data, _ = request("GET", "/api/me", cookie=cookie)
        assert status == 200 and data["user"]["username"] == "smoketest", data
        state = {"schemaVersion": 1, "records": {"e01": {"attempts": 1, "correct": 1}}}
        status, data, _ = request("PUT", "/api/progress", {"baseRevision": 0, "state": state}, cookie)
        assert status == 200 and data["revision"] == 1, data
        status, data, _ = request("GET", "/api/progress", cookie=cookie)
        assert status == 200 and data["state"] == state, data
        status, data, _ = request("PUT", "/api/progress", {"baseRevision": 0, "state": state}, cookie)
        assert status == 409 and data["revision"] == 1, data
        status, data, _ = request("POST", "/api/auth/logout", {}, cookie)
        assert status == 200, data
        print("Jingtu API smoke test passed")
    finally:
        process.terminate()
        process.wait(timeout=5)
