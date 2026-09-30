from fastapi.testclient import TestClient

from fillrate_optimizer.app import app

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_capabilities_document():
    body = client.get("/capabilities").json()
    assert body["schema_version"] == 1
    assert body["versions"]["pyvrp"] == "0.14.0"
    assert body["python"].startswith("3.13")
    behaviors = {b["id"]: b["provided_by"] for b in body["behaviors"]}
    assert behaviors["open_routes"] == "workaround"
    assert behaviors["max_leg_distance"] == "preprocessing"
    assert body["defaults"]["trailer_capacity"] == 5_300
    assert body["defaults"]["max_leg_m"] == 804_672
