"""Lab instance → PyVRP 0.14.0 model (spec §5 boundary 4, solver adapter).

Every mapping here is native PyVRP: named dimensions become capacity/delivery vectors in the
instance's dimension order, vehicle types keep their count, costs and limits, and every edge
carries the raw distance and duration. There are no synthetic terminal edges (every route
returns to a depot) and no omitted arcs. The builder is split per entity so a later capability
(shipments) changes one function.
"""

from __future__ import annotations

from dataclasses import dataclass

import pyvrp
from pyvrp.constants import MAX_VALUE

from .schema import LabInstance
from .travel import LabMatrices, stop_nodes

ADAPTER_VERSION = "fillrate-lab/1"


@dataclass
class LabModel:
    model: pyvrp.Model
    locations: list  # pyvrp.Location per matrix node
    depots: list  # pyvrp.Depot, instance order
    clients: list  # pyvrp.Client, instance order (PyVRP client index = list index)
    vehicle_types: list  # pyvrp.VehicleType, instance order (PyVRP type index = list index)


class LabBuildError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def check_range(instance: LabInstance, matrices: LabMatrices) -> None:
    """Keep every objective term well below PyVRP's MAX_VALUE so nothing overflows or saturates."""
    # Reloads add one depot stop per reload to a route's path.
    n = (
        len(instance.clients)
        + 2 * len(instance.pairs or [])
        + len(instance.depots)
        - 1
        + max(
            ((vt.max_reloads or 0) for vt in instance.vehicle_types if vt.reload_depots), default=0
        )
    )
    longest = int(matrices.distance.max()) * (n + 1)
    slowest = (
        int(matrices.duration.max()) * (n + 1)
        + sum(c.service_duration for c in instance.clients)
        + sum(s.service_duration for _p, s, _k in instance.pair_stops())
    )
    worst = 0
    for vt in instance.vehicle_types:
        per_route = (
            vt.fixed_cost + vt.unit_distance_cost * longest + vt.unit_duration_cost * slowest
        )
        worst += vt.count * per_route
    worst += sum(c.prize_value for c in instance.clients)
    if worst >= MAX_VALUE // 4:
        raise LabBuildError(
            "objective_out_of_range",
            f"The worst-case objective {worst} exceeds the safe bound for pinned PyVRP "
            f"({MAX_VALUE // 4}); reduce costs, coordinates or the fleet size.",
        )


def add_locations(model: pyvrp.Model, matrices: LabMatrices) -> list:
    # Coordinates passed to PyVRP are placeholders; every cost comes from an explicit edge.
    return [model.add_location(0, i, name=f"node-{i}") for i in range(matrices.distance.shape[0])]


def add_depots(model: pyvrp.Model, instance: LabInstance, locations: list) -> list:
    # Depots are the first locations, in instance order; clients follow.
    return [model.add_depot(locations[i], name=d.id) for i, d in enumerate(instance.depots)]


def add_client_groups(model: pyvrp.Model, instance: LabInstance) -> dict:
    """PyVRP groups by group id (mutually exclusive alternatives)."""
    return {
        g.id: model.add_client_group(required=g.required, name=g.id) for g in instance.groups or []
    }


def add_clients(
    model: pyvrp.Model, instance: LabInstance, locations: list, groups: dict | None = None
) -> list:
    group_of = instance.group_of()
    groups = groups or {}
    return [
        model.add_client(
            locations[len(instance.depots) + i],
            delivery=instance.delivery_vector(client),
            service_duration=client.service_duration,
            prize=client.prize_value,
            required=client.is_required,
            group=groups[group_of[client.id].id] if client.id in group_of else None,
            name=client.id,
        )
        for i, client in enumerate(instance.clients)
    ]


def add_shipments(model: pyvrp.Model, instance: LabInstance, locations: list) -> list:
    """Pickup-delivery pairs as native PyVRP shipments: the pickup and delivery stop nodes follow
    the clients, and PyVRP keeps both on one route, pickup first."""
    nodes = stop_nodes(instance)
    return [
        model.add_shipment(
            locations[nodes[pair.pickup.id]],
            locations[nodes[pair.delivery.id]],
            pickup_service_duration=pair.pickup.service_duration,
            delivery_service_duration=pair.delivery.service_duration,
            amount=instance.amount_vector(pair),
            name=pair.id,
        )
        for pair in instance.pairs or []
    ]


def add_vehicle_types(model: pyvrp.Model, instance: LabInstance, depots: list) -> list:
    out = []
    depot_by_id = {d.id: depots[i] for i, d in enumerate(instance.depots)}
    for vt in instance.vehicle_types:
        limits: dict[str, int] = {}
        if vt.max_distance is not None:
            limits["max_distance"] = vt.max_distance
        if vt.shift_duration is not None:
            limits["shift_duration"] = vt.shift_duration
        out.append(
            model.add_vehicle_type(
                num_available=vt.count,
                capacity=instance.capacity_vector(vt),
                start_depot=depot_by_id[instance.start_depot_of(vt)],
                end_depot=depot_by_id[instance.end_depot_of(vt)],
                reload_depots=[depot_by_id[d] for d in vt.reload_depots or []],
                max_reloads=(vt.max_reloads or 0) if vt.reload_depots else 0,
                fixed_cost=vt.fixed_cost,
                unit_distance_cost=vt.unit_distance_cost,
                unit_duration_cost=vt.unit_duration_cost,
                name=vt.id,
                **limits,
            )
        )
    return out


def add_edges(model: pyvrp.Model, locations: list, matrices: LabMatrices) -> None:
    distance, duration = matrices.distance, matrices.duration
    for i, frm in enumerate(locations):
        for j, to in enumerate(locations):
            if i != j:
                model.add_edge(frm, to, int(distance[i, j]), int(duration[i, j]))


def build_lab_model(instance: LabInstance, matrices: LabMatrices) -> LabModel:
    check_range(instance, matrices)
    model = pyvrp.Model()
    locations = add_locations(model, matrices)
    depots = add_depots(model, instance, locations)
    groups = add_client_groups(model, instance)
    clients = add_clients(model, instance, locations, groups)
    add_shipments(model, instance, locations)
    vehicle_types = add_vehicle_types(model, instance, depots)
    add_edges(model, locations, matrices)
    return LabModel(model, locations, depots, clients, vehicle_types)
