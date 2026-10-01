import pytest

from fillrate_optimizer.model import RunSettings, ScenarioDocument
from fillrate_optimizer.preflight import preflight_checks


def scenario():
    return ScenarioDocument.model_validate(
        {
            "name": "Preflight",
            "depot": {"id": "D", "label": "Depot", "lat": 0, "lon": 0},
            "products": [{"id": "P", "label": "Product", "linear_feet_per_piece": 3000}],
            "locations": [
                {
                    "id": "missing",
                    "label": "Missing",
                    "lat": None,
                    "lon": None,
                    "coordinate_source": "unresolved",
                },
                {"id": "far", "label": "Far", "lat": 0, "lon": 8, "coordinate_source": "imported"},
                {"id": "near", "label": "Near", "lat": 0, "lon": 1, "coordinate_source": "zcta"},
            ],
            "orders": [
                {
                    "id": f"O{i}",
                    "customer_id": "near-customer" if loc == "near" else f"customer-{i}",
                    "location_id": loc,
                    "order_date": "2026-09-30",
                    "lines": [
                        {
                            "id": f"L{i}",
                            "product_id": "P",
                            "ordered_pieces": 1,
                            "net_value_per_piece_cents": 100,
                        }
                    ],
                }
                for i, loc in enumerate(("missing", "far", "near", "near"), 1)
            ],
            "inventory": [{"product_id": "P", "available_pieces": 4}],
        }
    )


def test_preflight_policy_and_aggregate_stop():
    findings = preflight_checks(scenario(), RunSettings())
    assert [(f.check, f.action, f.line_ids) for f in findings] == [
        ("missing_coordinates", "block", ["L1"]),
        ("far_from_depot", "block", ["L2"]),
        ("oversize_stop", "warn", ["L3", "L4"]),
        ("approximate_coordinates", "warn", ["L3", "L4"]),
    ]
    blocking = RunSettings(preflight={"oversize_stop": "block"})
    assert ("oversize_stop", "block") in {
        (f.check, f.action) for f in preflight_checks(scenario(), blocking)
    }


def test_exclusion_and_override():
    settings = RunSettings(excluded_line_ids=["L3"], preflight={"far_from_depot": "warn"})
    assert [(f.check, f.action, f.line_ids) for f in preflight_checks(scenario(), settings)] == [
        ("missing_coordinates", "block", ["L1"]),
        ("far_from_depot", "warn", ["L2"]),
        ("approximate_coordinates", "warn", ["L4"]),
    ]
    with pytest.raises(ValueError, match="Unknown excluded line IDs"):
        preflight_checks(scenario(), RunSettings(excluded_line_ids=["absent"]))


def test_distinct_customers_at_same_location_do_not_trigger_oversize():
    doc = scenario()
    doc.orders[3].customer_id = "another-customer"
    assert "oversize_stop" not in {f.check for f in preflight_checks(doc, RunSettings())}


def test_far_stop_reachable_through_another_stop_only_warns():
    doc = scenario()
    # A stop halfway out makes "far" reachable in two drives under 500 mi each (round two).
    doc.locations.append(doc.locations[2].model_copy(update={"id": "mid", "lon": 4.0}))
    doc.orders.append(
        doc.orders[0].model_copy(
            update={
                "id": "O5",
                "location_id": "mid",
                "lines": [doc.orders[0].lines[0].model_copy(update={"id": "L5"})],
            }
        )
    )
    hits = {f.check: (f.action, f.line_ids) for f in preflight_checks(doc, RunSettings())}
    assert "far_from_depot" not in hits
    assert hits["far_via_stop"] == ("warn", ["L2"])
    # Excluding the intermediate stop's demand removes the chain, so the rule blocks again.
    excluded = RunSettings(excluded_line_ids=["L5"])
    hits = {f.check: f.action for f in preflight_checks(doc, excluded)}
    assert hits["far_from_depot"] == "block" and "far_via_stop" not in hits
