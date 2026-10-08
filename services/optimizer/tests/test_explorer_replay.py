"""k explorer replay semantics (spec §8a, §9, §13): what the explorer bundle README promises."""

import json
from pathlib import Path

import pytest

from fillrate_optimizer.canonical import content_hash
from fillrate_optimizer.explorer import run_explorer
from fillrate_optimizer.explorer_replay import (
    FLOAT_REL_TOL,
    differences,
    expected_record,
    main,
    replay,
)
from fillrate_optimizer.model import ExplorerSettings

from . import small_scenario

SCENARIO = small_scenario.build()
# A diameter limit so the repaired statistics differ from the raw ones and repairs are counted.
SETTINGS = ExplorerSettings(
    base=small_scenario.SETTINGS.model_copy(update={"max_cluster_diameter_m": 120_000}),
    ks=[2, 3],
    seeds=[0, 1, 2],
    selected_k=3,
    h3_resolutions=[2, 3],
)


@pytest.fixture(scope="module")
def recorded():
    summary = run_explorer(SCENARIO, SETTINGS, max_tasks=20)
    return summary, expected_record("explorer-1", summary)


@pytest.fixture
def bundle(tmp_path, recorded) -> Path:
    """The files the web export writes (`packages/db/src/replay.ts`, `explorerReplayBundle`)."""
    _, expected = recorded
    (tmp_path / "scenario.json").write_text(json.dumps(SCENARIO.model_dump(mode="json")))
    (tmp_path / "settings.json").write_text(json.dumps(SETTINGS.model_dump(mode="json")))
    (tmp_path / "expected.json").write_text(json.dumps(expected))
    return tmp_path


def edit(root: Path, name: str, change) -> None:
    path = root / name
    document = json.loads(path.read_text())
    change(document)
    path.write_text(json.dumps(document))


def test_the_fixture_exercises_repairs_and_h3(recorded):
    summary, expected = recorded
    assert any(any(row.diameter_repairs_by_seed) for row in summary.per_k)
    assert [row.resolution for row in summary.h3] == [2, 3]
    assert expected["travel"] == {"provider": "estimated", "metric": "spatial", "circuity": 1.2}
    assert expected["output_hash"] == content_hash(summary.model_dump(mode="json"))


def test_a_faithful_replay_is_bit_identical(bundle):
    lines: list[str] = []
    assert replay(bundle, out=lines.append) == []
    assert lines[-1] == "REPLAY OK"
    sections = [line.split()[0] for line in lines[1:-2]]
    assert sections == ["population", "selection", "settings", "per_k", "h3", "locations"]
    assert all(line.split()[1] == "reproduced" for line in lines[1:-2])
    assert lines[-2].split(maxsplit=1)[1] == "bit-identical to the recorded artifact"
    assert not any(line.startswith("note:") for line in lines)
    assert main([], root=bundle) == 0


def test_float_noise_within_tolerance_passes_but_is_not_bit_identical(bundle):
    def nudge(d):
        row = d["summary"]["per_k"][0]
        row["inertia_by_seed"][0] *= 1 + FLOAT_REL_TOL / 10

    edit(bundle, "expected.json", nudge)
    lines: list[str] = []
    assert replay(bundle, out=lines.append) == []
    assert "not bit-identical" in lines[-2]
    assert any("does not hash to the artifact's output_hash" in line for line in lines)


@pytest.mark.parametrize(
    ("section", "change", "path"),
    [
        ("per_k", lambda s: s["per_k"][1].update(stability_raw=0.5), "per_k[k=3].stability_raw"),
        (
            "per_k",
            lambda s: s["per_k"][0]["inertia_by_seed"].__setitem__(1, 1.0),
            "per_k[k=2].inertia_by_seed[1]",
        ),
        (
            "per_k",
            lambda s: s["per_k"][1]["diameter_repairs_by_seed"].__setitem__(0, 99),
            "per_k[k=3].diameter_repairs_by_seed[0]",
        ),
        ("h3", lambda s: s["h3"][0].update(raw_cluster_count=99), "h3[resolution=2]"),
        ("selection", lambda s: s.update(fits=s["fits"] + 1), "fits"),
        ("selection", lambda s: s.update(selected_k=2), "selected_k"),
        ("population", lambda s: s.update(locations_clustered=1), "locations_clustered"),
    ],
)
def test_tampered_expected_values_fail_with_a_clear_message(bundle, section, change, path):
    edit(bundle, "expected.json", lambda d: change(d["summary"]))
    lines: list[str] = []
    assert section in replay(bundle, out=lines.append)
    assert any(f"{section}" in line and f"DIFFERS: {path}" in line for line in lines), lines
    assert lines[-1].startswith("REPLAY FAILED")
    assert main([], root=bundle) == 1


def test_a_changed_seed_agreement_or_cluster_label_fails(bundle):
    def change(d):
        location = next(
            loc for loc in d["summary"]["locations"] if loc["agreement_raw"] is not None
        )
        location["agreement_raw"] = location["agreement_raw"] - 0.25
        d["summary"]["locations"][0]["reference_cluster"] += 1

    edit(bundle, "expected.json", change)
    lines: list[str] = []
    assert replay(bundle, out=lines.append) == ["locations"]
    assert any(".agreement_raw" in line and "DIFFERS" in line for line in lines)
    assert any(".reference_cluster" in line and "DIFFERS" in line for line in lines)


def test_edited_settings_are_not_the_recorded_experiment(bundle):
    edit(bundle, "settings.json", lambda d: d.update(seeds=[0, 1, 3]))
    failures = replay(bundle, out=lambda _: None)
    assert {"selection", "settings"} <= set(failures)


@pytest.mark.parametrize(
    "travel",
    [
        {"provider": "other", "profile": "truck"},
        {"provider": "estimated"},  # a pipeline declaration, not the spatial metric
    ],
)
def test_other_travel_providers_are_refused_before_any_rerun(bundle, travel):
    edit(bundle, "expected.json", lambda d: d.update(travel=travel))
    lines: list[str] = []
    assert replay(bundle, out=lines.append) == ["travel_provider"]
    assert "cannot be replayed" in lines[0]
    assert len(lines) == 1


def test_a_pipeline_bundle_is_not_an_explorer_bundle(bundle):
    edit(bundle, "expected.json", lambda d: d.pop("kind"))
    assert replay(bundle, out=lambda _: None) == ["kind"]


def test_comparison_rules():
    # Floating statistics: tolerance. Integers, labels and ids: exact. JSON may drop ".0".
    assert differences({"inertia": 3}, {"inertia": 3.0}, "h3") == []
    assert differences({"inertia": 1.0}, {"inertia": 1.0 + 1e-12}, "h3") == []
    assert differences({"inertia": 1.0}, {"inertia": 1.001}, "h3") != []
    assert differences({"raw_cluster_count": 3}, {"raw_cluster_count": 3.0000001}, "h3") != []
    assert differences({"stability_raw": None}, {"stability_raw": 0.0}, "k") != []
    assert differences([{"id": "a"}], [{"id": "b"}], "locations") == [
        ("locations[id=a].id", "a", "b")
    ]
