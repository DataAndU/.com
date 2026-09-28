import os
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from account import RoleBody, set_role
from deps import _same_origin_mutation, require_admin, require_role
from models import User


class ScalarDB:
    def __init__(self, value):
        self.value = value

    def scalar(self, _statement):
        return self.value

    def flush(self):
        pass


def request(method="POST", origin="https://app.example", site="same-origin"):
    headers = [(b"host", b"app.example")]
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    if site is not None:
        headers.append((b"sec-fetch-site", site.encode()))
    return Request({"type": "http", "method": method, "scheme": "https",
                    "server": ("app.example", 443), "path": "/api/me/role",
                    "headers": headers})


def test_role_selection_is_permanent(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    user = User(id="00000000-0000-0000-0000-000000000001",
                google_sub="user_1", email="a@example.com", display_name="A")
    db = ScalarDB(user)
    assert set_role(RoleBody(role="buyer"), db, user)["role"] == "buyer"
    with pytest.raises(HTTPException) as denied:
        set_role(RoleBody(role="provider"), db, user)
    assert denied.value.status_code == 409


def test_role_dependency_denies_other_role():
    with pytest.raises(HTTPException) as denied:
        require_role("provider")(SimpleNamespace(role="buyer"))
    assert denied.value.status_code == 403


def test_admin_is_separate_from_marketplace_role():
    with pytest.raises(HTTPException) as denied:
        require_admin(SimpleNamespace(is_admin=False, role="provider"))
    assert denied.value.status_code == 403
    admin = SimpleNamespace(is_admin=True, role="provider")
    assert require_admin(admin) is admin


def test_cross_origin_mutation_is_denied(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    with pytest.raises(HTTPException) as denied:
        _same_origin_mutation(request(origin="https://evil.example"))
    assert denied.value.status_code == 403




@pytest.mark.parametrize("origin,site", [
    (None, None),                              # no browser origin signal at all
    (None, "cross-site"),
    (None, "same-site"),                       # sibling subdomain is not Pontreol
    ("https://evil.example", None),
    ("https://app.example.evil.example", "same-origin"),
])
def test_cookie_mutations_require_same_origin(monkeypatch, origin, site):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    with pytest.raises(HTTPException) as denied:
        _same_origin_mutation(request(origin=origin, site=site))
    assert denied.value.status_code == 403


@pytest.mark.parametrize("origin,site", [
    ("https://app.example", "same-origin"), ("https://app.example", None), (None, "same-origin")])
def test_same_origin_mutations_allowed(monkeypatch, origin, site):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    _same_origin_mutation(request(origin=origin, site=site))


def test_safe_methods_skip_origin_check(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    _same_origin_mutation(request(method="GET", origin=None, site=None))
