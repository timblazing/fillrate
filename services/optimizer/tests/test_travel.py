import numpy as np

from fillrate_optimizer.travel import (
    DEFAULT_MAX_LEG_M,
    distance_matrix_m,
    haversine_m,
    miles_to_m,
    prohibited_legs,
)

MEMPHIS = (35.1495, -90.0490)
NASHVILLE = (36.1627, -86.7816)


def test_haversine_memphis_nashville():
    d = haversine_m(np.array([MEMPHIS, NASHVILLE]))
    miles = d[0, 1] / 1_609.344
    assert 190 < miles < 205
    assert d[0, 1] == d[1, 0]
    assert d[0, 0] == 0


def test_circuity_scales_and_rounds_to_integer_meters():
    coords = np.array([MEMPHIS, NASHVILLE])
    raw = haversine_m(coords)[0, 1]
    d = distance_matrix_m(coords, 1.2)
    assert d.dtype == np.int64
    assert d[0, 1] == round(raw * 1.2)


def test_default_leg_limit_is_500_miles():
    assert DEFAULT_MAX_LEG_M == miles_to_m(500) == 804_672


def test_prohibited_mask_excludes_diagonal():
    d = np.array([[0, 10, 900], [10, 0, 5], [900, 5, 0]])
    mask = prohibited_legs(d, 100)
    assert mask.tolist() == [[False, False, True], [False, False, False], [True, False, False]]
