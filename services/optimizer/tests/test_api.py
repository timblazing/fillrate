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
    assert diameter["availability"] == "implemented"


def solve_body(**overrides):
    from . import small_scenario

    settings = small_scenario.SETTINGS.model_copy(update=overrides)
    return {
        "kind": "pipeline",
        "solve_id": "t1",
        "scenario": small_scenario.build().model_dump(mode="json"),
        "settings": settings.model_dump(mode="json"),
    }


def test_solve_returns_summary_and_replay_stages():
    response = client.post("/solve", json=solve_body(solver_max_iterations=200))
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["validity"] == "valid"
    assert [s["stage"] for s in body["stages"]] == [
        "preflight",
        "allocation",
        "aggregation",
        "clustering",
    ]


def test_solve_reports_invalid_input_as_422():
    body = solve_body()
    body["settings"]["excluded_line_ids"] = ["nope"]
    response = client.post("/solve", json=body)
    assert response.status_code == 422
    assert response.json()["code"] == "unknown_line"


def test_cancel_kills_a_running_solve():
    import threading
    import time

    result = {}
    body = solve_body(solver_time_limit_s=60)
    thread = threading.Thread(
        target=lambda: result.update(response=client.post("/solve", json=body))
    )
    thread.start()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if client.post("/cancel/t1").json()["cancelled"]:
            break
        time.sleep(0.2)
    thread.join(timeout=30)
    assert result["response"].status_code == 409
    assert result["response"].json()["code"] == "cancelled"
    assert client.post("/cancel/t1").json() == {"cancelled": False}
