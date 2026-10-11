"""FastAPI bridge exposing a Bambu Lab printer status as JSON.

Designed to run on a homelab host next to the printer (local MQTT),
and be exposed publicly through a Cloudflare Tunnel:

    printer --MQTT(LAN)--> bambu-bridge --HTTPS+token--> cloudflared --> widget

Environment:
    BAMBU_IP            printer LAN IP (required unless BAMBU_MOCK=1)
    BAMBU_SERIAL        printer serial number (required unless BAMBU_MOCK=1)
    BAMBU_ACCESS_CODE   LAN access code, 8 digits (required unless BAMBU_MOCK=1)
    API_TOKEN           shared secret; clients send ``Authorization: Bearer``
    PORT                listen port (default 8080)
    BAMBU_POLL          snapshot refresh seconds (default 1.0)
    BAMBU_MOCK          set to 1 to serve simulated data (no printer needed)
"""

from __future__ import annotations

import hmac
import logging
import os

from fastapi import Depends, FastAPI, Header, HTTPException, status

from bambu_client import BambuClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
_LOGGER = logging.getLogger("bambu_bridge")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_flag(name: str) -> bool:
    return _env(name).lower() in {"1", "true", "yes", "on"}


MOCK = _env_flag("BAMBU_MOCK")
API_TOKEN = _env("API_TOKEN")

client = BambuClient(
    printer_ip=_env("BAMBU_IP"),
    access_code=_env("BAMBU_ACCESS_CODE"),
    serial=_env("BAMBU_SERIAL"),
    poll_seconds=float(_env("BAMBU_POLL", "1.0") or "1.0"),
    mock=MOCK,
)

app = FastAPI(title="Bambu Bridge", version="1.0.0")


def _validate_config() -> None:
    if not API_TOKEN:
        raise SystemExit("API_TOKEN is required (use a long random string)")
    if MOCK:
        return
    missing = [name for name in ("BAMBU_IP", "BAMBU_SERIAL", "BAMBU_ACCESS_CODE") if not _env(name)]
    if missing:
        raise SystemExit(f"missing required environment variables: {', '.join(missing)}")


def require_token(authorization: str = Header(default="")) -> None:
    expected = f"Bearer {API_TOKEN}"
    if not API_TOKEN or not hmac.compare_digest(authorization, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="unauthorized",
            headers={"WWW-Authenticate": "Bearer"},
        )


@app.on_event("startup")
def _startup() -> None:
    _validate_config()
    _LOGGER.info("starting bambu bridge (mock=%s)", MOCK)
    client.start()


@app.on_event("shutdown")
def _shutdown() -> None:
    client.stop()


@app.get("/health")
def health(_: None = Depends(require_token)) -> dict:
    return {
        "ok": True,
        "connected": client.connected,
        "error": client.last_error,
        "mock": MOCK,
    }


@app.get("/status")
def status_endpoint(_: None = Depends(require_token)) -> dict:
    payload = client.status()
    payload["ok"] = True
    return payload


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(_env("PORT", "8080") or "8080"))
