import math

import pytest

from fillrate_optimizer.loads import Stop

MEMPHIS = (35.1495, -90.0490)


def east(miles: float, origin: tuple[float, float] = MEMPHIS) -> tuple[float, float]:
    """A point `miles` due east (negative = west) of origin, by great-circle arc length."""
    lat, lon = origin
    deg = miles / (69.0934 * math.cos(math.radians(lat)))
    return lat, lon + deg


def north(miles: float, origin: tuple[float, float] = MEMPHIS) -> tuple[float, float]:
    lat, lon = origin
    return lat + miles / 69.0934, lon


def stop(id: str, at: tuple[float, float], load: int) -> Stop:
    return Stop(id=id, lat=at[0], lon=at[1], load=load)


@pytest.fixture
def memphis() -> tuple[float, float]:
    return MEMPHIS
