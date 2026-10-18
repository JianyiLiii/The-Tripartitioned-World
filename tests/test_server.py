"""API tests. Run from the project folder:  python -m unittest discover tests"""

import http.client
import json
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        env = Path(cls.tmp.name) / "test.env"
        env.write_text("ALLOWED_NAMES=Alice, 小明 ,bob\n", encoding="utf-8")
        args = server.parse_args(["--port", "0", "--env-file", str(env),
                                  "--data-dir", str(Path(cls.tmp.name) / "data")])
        cls.httpd = server.build_server(args)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.tmp.cleanup()

    def call(self, method, path, body=None, cookie=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = dict(headers or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers.setdefault("Content-Type", "application/json")
        if cookie:
            headers["Cookie"] = cookie
        conn.request(method, path, body=data, headers=headers)
        res = conn.getresponse()
        raw = res.read()
        conn.close()
        try:
            payload = json.loads(raw) if raw else None
        except ValueError:
            payload = raw.decode("utf-8", "replace")
        return res.status, payload, res

    def login(self, name):
        status, payload, res = self.call("POST", "/api/login", {"name": name})
        self.assertEqual(status, 200, payload)
        return res.getheader("Set-Cookie").split(";")[0]

    def test_local_username_change_keeps_identity(self):
        cookie = self.login("Rename Local")
        status, body, _ = self.call("PUT", "/api/me", {"displayName": "Renamed Local"}, cookie)
        self.assertEqual(status, 200)
        self.assertEqual(body["user"]["key"], "rename local")
        new_cookie = self.login("Renamed Local")
        self.assertEqual(self.call("GET", "/api/me", cookie=new_cookie)[1]["user"]["key"], "rename local")
        self.assertEqual(self.call("POST", "/api/login", {"name": "Rename Local"})[0], 403)

    def test_static_files_and_traversal(self):
        status, body, res = self.call("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("default-src 'self'", res.getheader("Content-Security-Policy"))
        for path in ("/../server.py", "/%2e%2e/server.py", "/..%5cserver.py", "/js/../../.env"):
            status, _, _ = self.call("GET", path)
            self.assertEqual(status, 404, path)

    def test_everything_needs_sign_in(self):
        for method, path in (("GET", "/api/me"), ("GET", "/api/projects"), ("POST", "/api/projects"),
                             ("GET", "/api/workspaces"), ("POST", "/api/workspaces")):
            status, payload, _ = self.call(method, path, {} if method == "POST" else None)
            self.assertEqual(status, 401, path)
        status, _, _ = self.call("GET", "/api/me", cookie="overlap_session=forged.token")
        self.assertEqual(status, 401)

    def test_time_api_works_locally_without_login_and_is_not_cached(self):
        with patch("server.time.time", return_value=1767225600.0):
            status, payload, response = self.call("GET", "/api/time")
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"unixMs": 1767225600000, "utc": "2026-01-01T00:00:00.000Z"})
        self.assertEqual(response.getheader("Cache-Control"), "no-store")

    def test_login_creates_profiles_and_matches_names_loosely(self):
        status, payload, _ = self.call("POST", "/api/login", {"name": "Mallory"})
        self.assertEqual((status, payload["user"]["name"]), (200, "Mallory"))
        cookie = self.login("  ALICE ")
        status, payload, _ = self.call("GET", "/api/me", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(payload["user"]["name"], "Alice")
        self.assertTrue({"Alice", "小明", "bob", "Mallory"}.issubset(
            {m["name"] for m in payload["members"]}))
        self.login("小明")
        cookie = self.login(" New   Person ")
        self.assertEqual(self.call("GET", "/api/me", cookie=cookie)[1]["user"]["key"], "new person")
        self.login("Ｎｅｗ Person")
        members = self.call("GET", "/api/me", cookie=cookie)[1]["members"]
        self.assertEqual(sum(m["key"] == "new person" for m in members), 1)
        for name in ("", "   ", None, 14, "x" * 81, "a\x00b"):
            status, payload, _ = self.call("POST", "/api/login", {"name": name})
            self.assertEqual((status, payload["error"]), (400, "invalid_name"))
        self.login("Alice")  # clear the invalid-input rate limit history

    def test_meeting_flow(self):
        alice, ming = self.login("alice"), self.login("小明")
        status, payload, _ = self.call("POST", "/api/projects",
                                       {"title": "  Weekly   sync ", "duration": 60}, alice)
        self.assertEqual(status, 201, payload)
        project = payload["project"]
        self.assertEqual(project["title"], "Weekly sync")
        pid = project["id"]

        # Ranges are minutes from Monday 00:00 in the person's own zone; overlapping ones merge.
        status, payload, _ = self.call("PUT", f"/api/projects/{pid}/availability",
                                       {"tz": "America/Vancouver", "ranges": [[600, 720], [540, 660], [1440, 1500]]}, alice)
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["availability"]["ranges"], [[540, 720], [1440, 1500]])

        for bad in ({"tz": "Asia/Shanghai", "ranges": [[0, 10081]]},
                    {"tz": "Asia/Shanghai", "ranges": [[10, 20]]},
                    {"tz": "Asia/Shanghai", "ranges": [["0", "30"]]},
                    {"tz": "../../etc", "ranges": []}):
            status, _, _ = self.call("PUT", f"/api/projects/{pid}/availability", bad, ming)
            self.assertEqual(status, 400, bad)

        status, _, _ = self.call("PUT", f"/api/projects/{pid}/availability",
                                 {"tz": "Asia/Shanghai", "ranges": [[0, 120]]}, ming)
        self.assertEqual(status, 200)
        status, payload, _ = self.call("GET", f"/api/projects/{pid}", cookie=ming)
        self.assertEqual(sorted(payload["availability"]), ["alice", "小明"])
        self.assertEqual(sorted(payload["project"]["filled"]), ["alice", "小明"])

        # Any invitee may adjust the meeting; only its creator may delete it.
        status, payload, _ = self.call("PATCH", f"/api/projects/{pid}", {"duration": 90}, ming)
        self.assertEqual((status, payload["project"]["duration"]), (200, 90))
        self.assertEqual(self.call("DELETE", f"/api/projects/{pid}", cookie=ming)[0], 403)
        self.assertEqual(self.call("DELETE", f"/api/projects/{pid}", cookie=alice)[0], 200)
        self.assertEqual(self.call("GET", f"/api/projects/{pid}", cookie=alice)[0], 404)

    def test_invitees_see_only_their_meetings(self):
        alice, ming, bob = self.login("alice"), self.login("小明"), self.login("bob")
        status, payload, _ = self.call("POST", "/api/projects",
                                       {"title": "Two of us", "invitees": ["小明", "nobody"]}, alice)
        self.assertEqual(status, 201, payload)
        # The creator is always invited; names not on the member list are dropped.
        self.assertEqual(payload["project"]["invitees"], ["alice", "小明"])
        pid = payload["project"]["id"]

        def titles(cookie):
            return [p["title"] for p in self.call("GET", "/api/projects", cookie=cookie)[1]["projects"]]

        self.assertIn("Two of us", titles(ming))
        self.assertNotIn("Two of us", titles(bob))
        self.assertEqual(self.call("GET", f"/api/projects/{pid}", cookie=bob)[0], 404)
        self.assertEqual(self.call("PUT", f"/api/projects/{pid}/availability",
                                   {"tz": "UTC", "ranges": []}, bob)[0], 404)

        # Invitees can change who is invited; the organizer always stays.
        status, payload, _ = self.call("PATCH", f"/api/projects/{pid}", {"invitees": ["bob"]}, alice)
        self.assertEqual((status, payload["project"]["invitees"]), (200, ["alice", "bob"]))
        self.assertEqual(self.call("GET", f"/api/projects/{pid}", cookie=bob)[0], 200)
        self.assertEqual(self.call("GET", f"/api/projects/{pid}", cookie=ming)[0], 404)
        self.assertEqual(self.call("PATCH", f"/api/projects/{pid}", {"invitees": []}, ming)[0], 404)
        status, payload, _ = self.call("PATCH", f"/api/projects/{pid}", {"invitees": []}, bob)
        self.assertEqual((status, payload["project"]["invitees"]), (200, ["alice"]))
        self.assertEqual(self.call("GET", f"/api/projects/{pid}", cookie=bob)[0], 404)

    def test_meeting_link_and_time(self):
        alice = self.login("alice")
        status, payload, _ = self.call("POST", "/api/projects",
                                       {"title": "Sync", "link": "https://zoom.us/j/123"}, alice)
        self.assertEqual((status, payload["project"]["link"]), (201, "https://zoom.us/j/123"))
        pid = payload["project"]["id"]
        for bad in ("javascript:alert(1)", "zoom.us/j/1", "ftp://example.com/x"):
            self.assertEqual(self.call("PATCH", f"/api/projects/{pid}", {"link": bad}, alice)[0], 400, bad)

        schedule = {"tz": "America/Vancouver", "date": "2026-10-20", "minute": 1320, "repeat": "weekly"}
        status, payload, _ = self.call("PATCH", f"/api/projects/{pid}", {"schedule": schedule}, alice)
        self.assertEqual((status, payload["project"]["schedule"]), (200, schedule))
        for bad in ({**schedule, "date": "2026-02-30"}, {**schedule, "minute": 1440},
                    {**schedule, "repeat": "daily"}, {**schedule, "tz": "no zone"}):
            self.assertEqual(self.call("PATCH", f"/api/projects/{pid}", {"schedule": bad}, alice)[0], 400, bad)
        status, payload, _ = self.call("PATCH", f"/api/projects/{pid}", {"schedule": None}, alice)
        self.assertIsNone(payload["project"]["schedule"])

    def test_profile_time_zone(self):
        bob = self.login("BOB")
        status, payload, _ = self.call("PUT", "/api/me", {"tz": "Europe/London"}, bob)
        self.assertEqual((status, payload["user"]["tz"]), (200, "Europe/London"))
        self.assertEqual(self.call("PUT", "/api/me", {"tz": "not a zone"}, bob)[0], 400)

    def test_cross_site_writes_are_rejected(self):
        alice = self.login("alice")
        status, payload, _ = self.call("POST", "/api/projects", {"title": "x"}, alice,
                                       {"Origin": "https://evil.example"})
        self.assertEqual((status, payload["error"]), (403, "cross_origin"))
        status, _, _ = self.call("POST", "/api/projects", {"title": "ok"}, alice,
                                 {"Origin": f"http://127.0.0.1:{self.port}"})
        self.assertEqual(status, 201)

    def test_failed_logins_are_rate_limited(self):
        app = self.httpd.app
        original = app.limiter
        app.limiter = server.LoginLimiter(per_ip=3)
        try:
            for _ in range(3):
                self.assertEqual(self.call("POST", "/api/login", {"name": ""})[0], 400)
            status, payload, res = self.call("POST", "/api/login", {"name": "alice"})
            self.assertEqual(status, 429)
            self.assertGreater(int(res.getheader("Retry-After")), 0)
        finally:
            app.limiter = original

    def test_data_survives_restart(self):
        alice = self.login("alice")
        status, payload, _ = self.call("POST", "/api/projects", {"title": "Persist me"}, alice)
        store = server.Store(self.httpd.app.config.data_dir / "db.json")
        self.assertIn(payload["project"]["id"], store.data["projects"])

    def test_workspace_membership_and_meeting_boundaries(self):
        alice, bob, ming = self.login("Alice"), self.login("bob"), self.login("小明")
        status, payload, _ = self.call("POST", "/api/workspaces", {
            "title": "  Product   launch ", "description": "Plan the release", "color": "#ABCDEF",
            "inviteNames": ["bob", "New Collaborator", " BOB "]}, alice)
        self.assertEqual(status, 201, payload)
        workspace = payload["workspace"]
        wid = workspace["id"]
        self.assertEqual(workspace["title"], "Product launch")
        self.assertEqual(workspace["color"], "#abcdef")
        self.assertEqual(workspace["owner"], "alice")
        self.assertEqual(workspace["members"], ["alice", "bob", "new collaborator"])
        self.assertEqual(self.call("GET", f"/api/workspaces/{wid}", cookie=bob)[0], 200)
        self.assertEqual(self.call("GET", f"/api/workspaces/{wid}", cookie=ming)[0], 404)
        self.assertNotIn(wid, [w["id"] for w in self.call("GET", "/api/workspaces", cookie=ming)[1]["workspaces"]])
        self.assertEqual(self.call("PATCH", f"/api/workspaces/{wid}", {"title": "Changed"}, bob)[0], 403)
        self.assertEqual(self.call("PATCH", f"/api/workspaces/{wid}", {"title": "Changed"}, alice)[0], 200)

        # Project members can create meetings, but cannot invite outside the project.
        status, payload, _ = self.call("POST", "/api/projects", {"title": "Team sync", "workspaceId": wid}, bob)
        self.assertEqual(status, 201, payload)
        meeting = payload["project"]
        self.assertEqual(set(meeting["invitees"]), set(workspace["members"]))
        self.assertEqual(meeting["createdBy"], "bob")
        self.assertEqual(meeting["workspaceId"], wid)
        self.assertEqual(self.call("POST", "/api/projects", {"title": "Intrusion", "workspaceId": wid}, ming)[0], 404)
        self.assertEqual(self.call("POST", "/api/projects", {
            "title": "Invalid invite", "workspaceId": wid, "invitees": ["小明"]}, alice)[0], 400)
        self.assertEqual(self.call("PATCH", f'/api/projects/{meeting["id"]}', {"invitees": ["小明"]}, alice)[0], 400)

        status, private, _ = self.call("POST", "/api/projects", {
            "title": "Private planning", "workspaceId": wid, "invitees": []}, alice)
        self.assertEqual(status, 201, private)
        detail = self.call("GET", f"/api/workspaces/{wid}", cookie=bob)[1]
        self.assertEqual([p["id"] for p in detail["meetings"]], [meeting["id"]])
        self.assertEqual(detail["workspace"]["meetingCount"], 1)
        self.assertEqual({m["key"] for m in detail["members"]}, set(workspace["members"]))
        self.assertEqual(self.call("GET", f'/api/projects/{private["project"]["id"]}', cookie=bob)[0], 404)
        response = self.call("GET", f'/api/projects/{meeting["id"]}', cookie=bob)[1]
        self.assertEqual({m["key"] for m in response["members"]}, set(workspace["members"]))

        # Invitation by name is additive and can precede the person's first login.
        status, response, _ = self.call("PATCH", f"/api/workspaces/{wid}", {"memberNames": ["Future Teammate"]}, bob)
        self.assertEqual(status, 200, response)
        future = self.login(" FUTURE teammate ")
        detail = self.call("GET", f"/api/workspaces/{wid}", cookie=future)[1]
        self.assertEqual(detail["meetings"], [])
        self.assertIn("future teammate", detail["workspace"]["members"])

    def test_workspace_invite_link_preview_and_join(self):
        alice, visitor = self.login("Alice"), self.login("Link Visitor")
        workspace = self.call("POST", "/api/workspaces", {"title": "Invite link project"}, alice)[1]["workspace"]
        wid, code = workspace["id"], workspace["inviteCode"]
        meeting = self.call("POST", "/api/projects", {"title": "Existing meeting", "workspaceId": wid}, alice)[1]["project"]
        status, payload, _ = self.call("GET", f"/api/invites/{code}")
        self.assertEqual(status, 200)
        self.assertEqual(set(payload), {"workspace", "memberCount"})
        self.assertEqual(set(payload["workspace"]), {"id", "title", "description"})
        self.assertEqual(payload["memberCount"], 1)
        self.assertEqual(self.call("POST", f"/api/invites/{code}/join", {})[0], 401)
        for _ in range(2):
            status, payload, _ = self.call("POST", f"/api/invites/{code}/join", {}, visitor)
            self.assertEqual(status, 200, payload)
            self.assertEqual(payload["workspace"]["members"].count("link visitor"), 1)
        self.assertEqual(self.call("GET", f"/api/workspaces/{wid}", cookie=visitor)[1]["meetings"], [])
        self.assertEqual(self.call("GET", f'/api/projects/{meeting["id"]}', cookie=visitor)[0], 404)
        self.assertEqual(self.call("GET", "/api/invites/invalidcodeinvalidcode")[0], 404)
        self.assertEqual(self.call("POST", "/api/invites/invalidcodeinvalidcode/join", {}, visitor)[0], 404)
        # A later meeting includes current project members by default.
        new_meeting = self.call("POST", "/api/projects", {"title": "Welcome", "workspaceId": wid}, alice)[1]["project"]
        self.assertEqual(self.call("GET", f'/api/projects/{new_meeting["id"]}', cookie=visitor)[0], 200)

    def test_workspace_rejects_bad_input_without_partial_changes(self):
        alice = self.login("Alice")
        for bad in ({"title": ""}, {"title": "x", "color": "red"}, {"title": "x", "description": "a" * 501},
                    {"title": "x", "inviteNames": "Bob"}, {"title": "x", "inviteNames": ["Bob", 1]},
                    {"title": "x", "inviteNames": ["Bob"] * 101}):
            self.assertEqual(self.call("POST", "/api/workspaces", bad, alice)[0], 400, bad)
        workspace = self.call("POST", "/api/workspaces", {"title": "Atomic project"}, alice)[1]["workspace"]
        path = f'/api/workspaces/{workspace["id"]}'
        self.assertEqual(self.call("PATCH", path, {
            "title": "Should not change", "inviteNames": ["Do Not Save", ""]}, alice)[0], 400)
        response = self.call("GET", path, cookie=alice)[1]
        self.assertEqual(response["workspace"]["title"], "Atomic project")
        self.assertEqual(response["workspace"]["members"], ["alice"])
        self.assertNotIn("do not save", self.httpd.app.members_by_key)
        for bad_id in ([], {}, 12):
            self.assertEqual(self.call("POST", "/api/projects", {"title": "Bad reference", "workspaceId": bad_id}, alice)[0], 400)

    def test_profiles_and_workspaces_persist_without_configuration(self):
        with tempfile.TemporaryDirectory() as temp:
            args = server.parse_args(["--env-file", str(Path(temp) / "missing.env"), "--data-dir", temp])
            config = server.Config(args)
            config.members = []
            first = server.App(config)
            request = server.ApiRequest("POST", "/api/login", {}, b'{"name":"Local Person"}', "test", False)
            result = first.dispatch(request)
            cookie = result[2]["Set-Cookie"].split(";")[0]
            request = server.ApiRequest("POST", "/api/workspaces", {"Cookie": cookie}, b'{"title":"Saved project"}', "test", False)
            wid = first.dispatch(request)[1]["workspace"]["id"]
            second = server.App(config)
            request = server.ApiRequest("GET", f"/api/workspaces/{wid}", {"Cookie": cookie}, b"", "test", False)
            result = second.dispatch(request)
            self.assertEqual(result[0], 200)
            self.assertEqual(result[1]["members"][0]["name"], "Local Person")

    def test_legacy_meetings_migrate_without_losing_availability(self):
        with tempfile.TemporaryDirectory() as temp:
            legacy = {"version": 1, "projects": {"oldmeet1": {
                "id": "oldmeet1", "title": "Old meeting", "createdBy": "legacy user",
                "invitees": ["legacy user"], "createdAt": 1, "updatedAt": 1}},
                "availability": {"oldmeet1": {"legacy user": {"tz": "UTC", "ranges": [[60, 120]]}}},
                "profiles": {"legacy user": {"tz": "UTC"}}}
            (Path(temp) / "db.json").write_text(json.dumps(legacy), encoding="utf-8")
            config = server.Config(server.parse_args(["--env-file", str(Path(temp) / "missing.env"), "--data-dir", temp]))
            config.members = []
            app = server.App(config)
            self.assertEqual(app.store.data["version"], 2)
            self.assertEqual(app.store.data["projects"], legacy["projects"])
            self.assertEqual(app.store.data["availability"], legacy["availability"])
            self.assertEqual(app.member_view("legacy user")["tz"], "UTC")
            cookie = server.COOKIE_NAME + "=" + app.signer.issue("legacy user")
            req = server.ApiRequest("GET", "/api/projects/oldmeet1", {"Cookie": cookie}, b"", "test", False)
            self.assertEqual(app.dispatch(req)[0], 200)

    def test_legacy_meetings_do_not_silently_invite_new_profiles(self):
        with tempfile.TemporaryDirectory() as temp:
            legacy = {"version": 1, "projects": {"oldmeet2": {
                "id": "oldmeet2", "title": "Before invitations", "createdBy": "alice",
                "createdAt": 1, "updatedAt": 1}}, "availability": {}, "profiles": {}}
            (Path(temp) / "db.json").write_text(json.dumps(legacy), encoding="utf-8")
            config = server.Config(server.parse_args(["--env-file", str(Path(temp) / "missing.env"), "--data-dir", temp]))
            config.members = server.parse_members("Alice, Bob")
            app = server.App(config)
            req = server.ApiRequest("POST", "/api/login", {}, b'{"name":"Newcomer"}', "test", False)
            cookie = app.dispatch(req)[2]["Set-Cookie"].split(";")[0]
            self.assertEqual(app.store.data["projects"]["oldmeet2"]["invitees"], ["alice", "bob"])
            req = server.ApiRequest("GET", "/api/projects", {"Cookie": cookie}, b"", "test", False)
            self.assertEqual(app.dispatch(req)[1]["projects"], [])
            restarted = server.App(config)
            self.assertEqual(restarted.store.data["projects"]["oldmeet2"]["invitees"], ["alice", "bob"])


if __name__ == "__main__":
    unittest.main()
