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


def test_only_implemented_capabilities_have_executable_fixtures():
    from pathlib import Path

    body = client.get("/capabilities").json()
    for behavior in body["behaviors"]:
        if behavior["availability"] == "implemented":
            file, name = behavior["fixture"].split("::")
            assert f"def {name}(" in Path(file).read_text()
        else:
            assert behavior["fixture"] is None
    diameter = next(b for b in body["behaviors"] if b["id"] == "max_cluster_diameter")
    assert diameter["availability"] == "planned"
