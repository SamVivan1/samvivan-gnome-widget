"""Persistent Bambu Lab printer client.

Keeps a single MQTT connection to the printer alive and exposes a
thread-safe normalized status snapshot for the HTTP API.

Uses ``bambulabs_api`` (https://github.com/BambuTools/bambulabs_api).
For A1 / A1 mini the printer must be in LAN mode (or Developer Mode)
so the local MQTT broker accepts the ``bblp`` / access-code login.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

try:
    import bambulabs_api as bl
except ImportError:  # pragma: no cover - installed in the Docker image
    bl = None

_LOGGER = logging.getLogger("bambu_bridge")

# gcode_state values reported by the printer.
_STATE_LABELS = {
    "IDLE": "IDLE",
    "RUNNING": "RUNNING",
    "PAUSE": "PAUSE",
    "FINISH": "FINISH",
    "FAILED": "FAILED",
    "PREPARE": "PREPARE",
    "SLICING": "SLICING",
    "UNKNOWN": "UNKNOWN",
}

_SPEED_LABELS = {0: "Silent", 1: "Standard", 2: "Sport", 3: "Ludicrous"}


def _as_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


def _as_int(value: Any) -> int | None:
    number = _as_number(value)
    return None if number is None else int(number)


class BambuClient:
    """Owns the MQTT connection and a cached status snapshot."""

    def __init__(self, printer_ip: str, access_code: str, serial: str,
                 poll_seconds: float = 1.0, mock: bool = False) -> None:
        self._ip = printer_ip
        self._access_code = access_code
        self._serial = serial
        self._poll_seconds = max(0.5, float(poll_seconds))
        self._mock = mock

        self._printer: bl.Printer | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

        self._snapshot: dict[str, Any] = _empty_snapshot()
        self._connected = False
        self._last_error = ""
        self._mock_started = 0.0

        if self._mock:
            self._mock_started = time.time()

    # ------------------------------------------------------------------ API

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="bambu-poll", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=3)
            self._thread = None
        self._disconnect()

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def last_error(self) -> str:
        return self._last_error

    def status(self) -> dict[str, Any]:
        with self._lock:
            snapshot = dict(self._snapshot)
        snapshot["connected"] = self._connected
        snapshot["error"] = self._last_error
        snapshot["updated"] = int(time.time())
        return snapshot

    # -------------------------------------------------------------- internals

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                if self._mock:
                    self._update_mock()
                else:
                    self._update_live()
            except Exception as error:  # noqa: BLE001 - never let the loop die
                self._connected = False
                self._last_error = f"{type(error).__name__}: {error}"
                _LOGGER.warning("status poll failed: %s", self._last_error)
            self._stop.wait(self._poll_seconds)

    def _ensure_printer(self) -> bool:
        if self._printer is None:
            if bl is None:
                self._last_error = "bambulabs_api is not installed (pip install -r requirements.txt)"
                return False
            try:
                self._printer = bl.Printer(self._ip, self._access_code, self._serial)
                self._printer.mqtt_start()
                _LOGGER.info("opened MQTT connection to %s", self._ip)
            except Exception as error:  # noqa: BLE001
                self._printer = None
                self._last_error = f"connect failed: {error}"
                return False

        try:
            if self._printer.mqtt_client_connected():
                return True
            _LOGGER.info("MQTT disconnected, reconnecting to %s", self._ip)
            try:
                self._printer.mqtt_stop()
            except Exception:  # noqa: BLE001
                pass
            self._printer.mqtt_start()
            return bool(self._printer.mqtt_client_connected())
        except Exception as error:  # noqa: BLE001
            self._last_error = f"connection check failed: {error}"
            return False

    def _update_live(self) -> None:
        if not self._ensure_printer():
            self._connected = False
            return

        dump = self._safe_dump()
        snapshot = self._normalize(dump)
        self._connected = True
        self._last_error = ""
        with self._lock:
            self._snapshot = snapshot

    def _safe_dump(self) -> dict[str, Any]:
        if self._printer is None:
            return {}
        try:
            raw = self._printer.mqtt_dump() or {}
        except Exception as error:  # noqa: BLE001
            _LOGGER.debug("mqtt_dump failed: %s", error)
            return {}
        if isinstance(raw, dict) and isinstance(raw.get("print"), dict):
            return raw["print"]
        return raw if isinstance(raw, dict) else {}

    def _normalize(self, dump: dict[str, Any]) -> dict[str, Any]:
        printer = self._printer
        data = dump or {}

        state_raw = str(data.get("gcode_state", "") or "").upper()
        state = _STATE_LABELS.get(state_raw, state_raw or "UNKNOWN")

        percentage = _as_int(data.get("mc_percent"))
        if percentage is None and printer is not None:
            percentage = _as_int(self._safe_call(printer.get_percentage))
        if percentage is not None:
            percentage = max(0, min(100, percentage))

        remaining = _as_int(data.get("mc_remaining_time"))
        if remaining is None and printer is not None:
            remaining = _as_int(self._safe_call(printer.get_time))

        layer = _as_int(data.get("layer_num"))
        total_layers = _as_int(data.get("total_layer_num"))

        nozzle = _as_number(data.get("nozzle_temper"))
        nozzle_target = _as_number(data.get("nozzle_target_temper"))
        bed = _as_number(data.get("bed_temper"))
        bed_target = _as_number(data.get("bed_target_temper"))
        chamber = _as_number(data.get("chamber_temper"))

        speed_level = _as_int(data.get("spd_lvl"))
        speed = _SPEED_LABELS.get(speed_level) if speed_level is not None else None

        filename = data.get("subtask_name") or data.get("gcode_file") or ""
        if not filename and printer is not None:
            filename = self._safe_call(printer.subtask_name) or ""

        error_code = _as_int(data.get("print_error")) or 0

        return {
            "printer": {
                "name": data.get("printer_name") or "A1",
                "model": data.get("printer_type") or data.get("machine") or "A1",
                "online": True,
                "wifi": data.get("wifi_signal"),
            },
            "job": {
                "state": state,
                "file": str(filename),
                "progress": percentage,
                "remaining_min": remaining,
                "layer": layer,
                "total_layers": total_layers,
                "speed_level": speed_level,
                "speed": speed,
                "error_code": error_code,
            },
            "temperatures": {
                "nozzle": nozzle,
                "nozzle_target": nozzle_target,
                "bed": bed,
                "bed_target": bed_target,
                "chamber": chamber,
            },
            "filament": {
                "ams": self._ams(data),
                "active": _as_int(data.get("tray_now")),
            },
            "raw": {},
        }

    def _ams(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        trays: list[dict[str, Any]] = []
        ams = data.get("ams")

        if isinstance(ams, dict):
            for unit in ams.get("ams", []) or []:
                unit_id = unit.get("id")
                for tray in unit.get("tray", []) or []:
                    trays.append({
                        "unit": unit_id,
                        "slot": tray.get("id"),
                        "type": tray.get("tray_type") or "",
                        "color": _normalize_color(tray.get("tray_color")),
                        "active": tray.get("id") == ams.get("tray_now"),
                    })
            if not trays and ams.get("tray_now") not in (None, 255):
                trays.append({
                    "unit": 0,
                    "slot": ams.get("tray_now"),
                    "type": data.get("vt_tray", {}).get("tray_type", ""),
                    "color": _normalize_color(data.get("vt_tray", {}).get("tray_color")),
                    "active": True,
                })

        return trays

    def _safe_call(self, fn):
        try:
            return fn()
        except Exception:  # noqa: BLE001
            return None

    def _update_mock(self) -> None:
        elapsed = time.time() - self._mock_started
        progress = int((elapsed % 600) / 600 * 100)
        remaining = max(0, int((600 - (elapsed % 600)) / 60))

        self._connected = True
        self._last_error = ""
        with self._lock:
            self._snapshot = {
                "printer": {
                    "name": "A1 mini",
                    "model": "A1 mini",
                    "online": True,
                    "wifi": "-56dBm",
                },
                "job": {
                    "state": "RUNNING",
                    "file": "benchy_0.2mm_PLA_A1_18m.gcode.3mf",
                    "progress": progress,
                    "remaining_min": remaining,
                    "layer": progress * 2,
                    "total_layers": 200,
                    "speed_level": 2,
                    "speed": "Sport",
                    "error_code": 0,
                },
                "temperatures": {
                    "nozzle": 218.5,
                    "nozzle_target": 220.0,
                    "bed": 59.4,
                    "bed_target": 60.0,
                    "chamber": None,
                },
                "filament": {
                    "ams": [
                        {"unit": 0, "slot": 0, "type": "PLA", "color": "#e03030", "active": True},
                        {"unit": 0, "slot": 1, "type": "PETG", "color": "#3070e0", "active": False},
                    ],
                    "active": 0,
                },
                "raw": {},
            }

    def _disconnect(self) -> None:
        if self._printer is None:
            return
        try:
            self._printer.mqtt_stop()
        except Exception:  # noqa: BLE001
            pass
        try:
            self._printer.disconnect()
        except Exception:  # noqa: BLE001
            pass
        self._printer = None
        self._connected = False


def _empty_snapshot() -> dict[str, Any]:
    return {
        "printer": {"name": "Bambu Lab", "model": "", "online": False, "wifi": None},
        "job": {
            "state": "IDLE",
            "file": "",
            "progress": None,
            "remaining_min": None,
            "layer": None,
            "total_layers": None,
            "speed_level": None,
            "speed": None,
            "error_code": 0,
        },
        "temperatures": {
            "nozzle": None,
            "nozzle_target": None,
            "bed": None,
            "bed_target": None,
            "chamber": None,
        },
        "filament": {"ams": [], "active": None},
        "raw": {},
    }


def _normalize_color(value: Any) -> str:
    if not value:
        return ""
    text = str(value).strip()
    if len(text) >= 6:
        return f"#{text[0:6]}"
    return text
