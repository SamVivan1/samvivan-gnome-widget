import os

from fastapi.testclient import TestClient

os.environ["BAMBU_MOCK"] = "1"
os.environ["API_TOKEN"] = "test-token"

import app as bridge_app


def make_client() -> TestClient:
    return TestClient(bridge_app.app)


def test_health_rejects_missing_token():
    with make_client() as client:
        response = client.get("/health")

    assert response.status_code == 401
    assert response.json()["detail"] == "unauthorized"
    assert response.headers["www-authenticate"] == "Bearer"


def test_health_rejects_a_wrong_token():
    with make_client() as client:
        response = client.get("/health", headers={"Authorization": "Bearer wrong"})

    assert response.status_code == 401


def test_health_accepts_the_configured_token():
    with make_client() as client:
        response = client.get("/health", headers={"Authorization": "Bearer test-token"})

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["mock"] is True


def test_status_returns_the_widget_contract():
    with make_client() as client:
        response = client.get("/status", headers={"Authorization": "Bearer test-token"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["connected"] is True
    assert payload["job"]["state"] in {"IDLE", "RUNNING", "PAUSE", "FINISH", "FAILED"}
    assert isinstance(payload["filament"]["ams"], list)
    assert isinstance(payload["temperatures"], dict)
