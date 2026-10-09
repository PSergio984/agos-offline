"""Boundary tests for the weather label mappers and the extended
get_current_weather payload keys."""

import asyncio

import httpx
import pytest

from app.services.weather_service import WeatherService
from app.utils.weather_mappers import (
    get_cloudiness,
    get_comfort_level,
    get_humidity_level,
    get_storm_risk_level,
    get_temperature_description,
    get_weather_description,
    get_wind_category,
    get_wind_direction_label,
)


@pytest.mark.parametrize(
    "precip, expected",
    [
        (0.0, "No rainfall detected"),
        (2.5, "Light precipitation"),
        (2.6, "Moderate rainfall intensity"),
        (10.0, "Moderate rainfall intensity"),
        (10.1, "Heavy rainfall detected"),
        (50.0, "Heavy rainfall detected"),
        (50.1, "Extreme rainfall conditions"),
    ],
)
def test_weather_description_boundaries(precip, expected):
    assert get_weather_description(precip) == expected


@pytest.mark.parametrize(
    "temp, expected",
    [(14.9, "Cold"), (15.0, "Cool"), (21.9, "Cool"), (22.0, "Warm"), (29.9, "Warm"), (30.0, "Hot")],
)
def test_temperature_description_boundaries(temp, expected):
    assert get_temperature_description(temp) == expected


@pytest.mark.parametrize(
    "humidity, expected",
    [(39.9, "Dry"), (40.0, "Comfortable"), (59.9, "Comfortable"), (60.0, "Humid"), (80.0, "Very humid")],
)
def test_humidity_level_boundaries(humidity, expected):
    assert get_humidity_level(humidity) == expected


@pytest.mark.parametrize(
    "speed, expected",
    [
        (4.9, "Calm"),
        (5.0, "Light breeze"),
        (14.9, "Light breeze"),
        (15.0, "Breezy"),
        (29.9, "Breezy"),
        (30.0, "Strong winds"),
        (49.9, "Strong winds"),
        (50.0, "High winds"),
    ],
)
def test_wind_category_boundaries(speed, expected):
    assert get_wind_category(speed) == expected


@pytest.mark.parametrize(
    "degrees, expected",
    [
        (0, "N"),
        (22.4, "N"),
        (22.5, "NE"),
        (44.9, "NE"),
        (45.0, "NE"),
        (67.4, "NE"),
        (67.5, "E"),
        (112.5, "SE"),
        (180.0, "S"),
        (270.0, "W"),
        (350.0, "N"),
        (360.0, "N"),
        (720.0, "N"),
    ],
)
def test_wind_direction_label_boundaries(degrees, expected):
    assert get_wind_direction_label(degrees) == expected


@pytest.mark.parametrize(
    "cover, expected",
    [(19.9, "Clear"), (20.0, "Partly cloudy"), (49.9, "Partly cloudy"), (50.0, "Mostly cloudy"), (80.0, "Overcast")],
)
def test_cloudiness_boundaries(cover, expected):
    assert get_cloudiness(cover) == expected


@pytest.mark.parametrize(
    "temp, humidity, expected",
    [
        (10.0, 90.0, "Cool"),
        (18.0, 75.0, "Cool & damp"),
        (18.0, 50.0, "Comfortable"),
        (25.0, 40.0, "Comfortable"),
        (25.0, 60.0, "Warm & humid"),
        (25.0, 75.0, "Uncomfortable"),
        (30.0, 35.0, "Hot but tolerable"),
        (30.0, 50.0, "Uncomfortable"),
        (30.0, 70.0, "Oppressive"),
        (36.0, 60.0, "Heat stress risk"),
        (36.0, 30.0, "Very hot"),
    ],
)
def test_comfort_level(temp, humidity, expected):
    assert get_comfort_level(temp, humidity) == expected


@pytest.mark.parametrize(
    "code, precip, wind, expected",
    [
        (95, 0.0, 0.0, "Likely"),
        (99, 0.0, 0.0, "Likely"),
        (80, 20.0, 40.0, "Possible"),
        (1, 11.0, 31.0, "Possible"),
        (61, 20.0, 10.0, "Low"),
        (81, 0.0, 40.0, "Low"),
        (1, 0.0, 40.0, "None"),
        (3, 0.0, 0.0, "None"),
    ],
)
def test_storm_risk_level(code, precip, wind, expected):
    assert get_storm_risk_level(code, precip, wind) == expected


# --- get_current_weather payload extension -----------------------------------

NEW_PAYLOAD_KEYS = [
    "wind_speed_kmh",
    "wind_direction_degrees",
    "cloud_cover_percent",
    "precipitation_description",
    "temperature_description",
    "humidity_level",
    "wind_category",
    "wind_direction_label",
    "cloudiness",
    "comfort_level",
    "storm_risk_level",
]


class _FakeResponse:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _fake_open_meteo_client(current):
    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url):
            return _FakeResponse({"current": current})

    return FakeAsyncClient


def _failing_client(error):
    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url):
            raise error

    return FakeAsyncClient


def test_get_current_weather_online_includes_extended_fields(monkeypatch):
    """Online payload carries wind/cloud telemetry plus derived label strings."""
    service = WeatherService()  # fresh instance: the conftest stub only patches the singleton
    current = {
        "temperature_2m": 30.0,
        "relative_humidity_2m": 70.0,
        "precipitation": 12.5,
        "weather_code": 80,
        "wind_speed_10m": 35.0,
        "wind_direction_10m": 45.0,
        "cloud_cover": 85.0,
    }
    monkeypatch.setattr(
        "app.services.weather_service.httpx.AsyncClient",
        _fake_open_meteo_client(current),
    )

    payload = asyncio.run(service.get_current_weather())

    # Existing keys untouched
    assert payload["is_online"] is True
    assert payload["rainfall_mm"] == 12.5
    assert payload["temperature_c"] == 30.0
    assert payload["humidity_pct"] == 70.0
    assert payload["weather_code"] == 80

    # New raw telemetry
    assert payload["wind_speed_kmh"] == 35.0
    assert payload["wind_direction_degrees"] == 45.0
    assert payload["cloud_cover_percent"] == 85.0

    # Derived labels
    assert payload["precipitation_description"] == "Heavy rainfall detected"
    assert payload["temperature_description"] == "Hot"
    assert payload["humidity_level"] == "Humid"
    assert payload["wind_category"] == "Strong winds"
    assert payload["wind_direction_label"] == "NE"
    assert payload["cloudiness"] == "Overcast"
    assert payload["comfort_level"] == "Oppressive"
    assert payload["storm_risk_level"] == "Possible"


def test_get_current_weather_never_online_fallback_new_keys_none(monkeypatch):
    """The never-online fallback exposes the new keys as None."""
    service = WeatherService()
    monkeypatch.setattr(
        "app.services.weather_service.httpx.AsyncClient",
        _failing_client(httpx.NetworkError("no route to host")),
    )

    payload = asyncio.run(service.get_current_weather())

    assert payload["is_online"] is False
    assert payload["condition"] == "Offline Mode"
    for key in NEW_PAYLOAD_KEYS:
        assert key in payload
        assert payload[key] is None
