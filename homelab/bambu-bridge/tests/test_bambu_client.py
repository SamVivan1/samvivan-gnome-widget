from bambu_client import (
    BambuClient,
    _as_int,
    _as_number,
    _empty_snapshot,
    _normalize_color,
)


def make_client() -> BambuClient:
    return BambuClient("127.0.0.1", "access-code", "serial", poll_seconds=1.0, mock=True)


def test_as_number_accepts_numeric_strings_and_rejects_junk():
    assert _as_number("21.5") == 21.5
    assert _as_number(7) == 7.0
    assert _as_number(None) is None
    assert _as_number("not-a-number") is None


def test_as_int_truncates_numbers_and_rejects_junk():
    assert _as_int("57.9") == 57
    assert _as_int(3.2) == 3
    assert _as_int(None) is None
    assert _as_int("") is None


def test_normalize_color_trims_hashless_values():
    assert _normalize_color("FF0000FF") == "#FF0000"
    assert _normalize_color("#00FF00") == "#00FF00"
    assert _normalize_color("abc") == "abc"
    assert _normalize_color("") == ""
    assert _normalize_color(None) == ""


def test_empty_snapshot_matches_the_widget_contract():
    snapshot = _empty_snapshot()

    assert snapshot["printer"]["online"] is False
    assert snapshot["job"]["state"] == "IDLE"
    assert snapshot["job"]["progress"] is None
    assert snapshot["temperatures"]["nozzle"] is None
    assert snapshot["filament"] == {"ams": [], "active": None}


def test_normalize_maps_printer_status_and_clamps_progress():
    client = make_client()
    result = client._normalize({
        "gcode_state": "running",
        "mc_percent": 157,
        "mc_remaining_time": "42",
        "layer_num": "3",
        "total_layer_num": 10,
        "nozzle_temper": "220.5",
        "nozzle_target_temper": 220,
        "bed_temper": 60,
        "bed_target_temper": 60,
        "chamber_temper": 30,
        "spd_lvl": 2,
        "subtask_name": "cube.gcode",
        "printer_name": "A1",
        "printer_type": "A1 mini",
        "wifi_signal": "-55dBm",
        "ams": {"tray_now": 0, "ams": [{
            "id": 0,
            "tray": [{"id": 0, "tray_type": "PLA", "tray_color": "FF0000FF"}],
        }]},
    })

    assert result["printer"]["name"] == "A1"
    assert result["printer"]["model"] == "A1 mini"
    assert result["job"]["state"] == "RUNNING"
    assert result["job"]["progress"] == 100
    assert result["job"]["remaining_min"] == 42
    assert result["job"]["layer"] == 3
    assert result["job"]["total_layers"] == 10
    assert result["job"]["speed"] == "Sport"
    assert result["temperatures"]["nozzle"] == 220.5
    assert result["filament"]["active"] == 0
    assert result["filament"]["ams"] == [{
        "unit": 0,
        "slot": 0,
        "type": "PLA",
        "color": "#FF0000",
        "active": True,
    }]


def test_normalize_clamps_negative_progress_and_handles_missing_fields():
    client = make_client()
    result = client._normalize({"gcode_state": "idle", "mc_percent": -20})

    assert result["job"]["state"] == "IDLE"
    assert result["job"]["progress"] == 0
    assert result["job"]["file"] == ""
    assert result["filament"]["ams"] == []


def test_status_returns_a_copy_with_connection_metadata():
    client = make_client()
    client._connected = True
    client._last_error = ""
    client._snapshot["job"]["state"] = "RUNNING"

    status = client.status()
    assert status["connected"] is True
    assert status["error"] == ""
    assert isinstance(status["updated"], int)
    assert status["job"]["state"] == "RUNNING"

    status["job"]["state"] = "MUTATED"
    assert client._snapshot["job"]["state"] == "RUNNING"
