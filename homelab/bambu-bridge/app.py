"""FastAPI bridge exposing a Bambu Lab printer status as JSON.

Designed to run on a homelab host next to the printer (local MQTT),
and be exposed publicly through a Cloudflare Tunnel:

    printer --MQTT(LAN)--> bambu-bridge --HTTPS+token--> cloudflared --> widget

Environment:
    BAMBU_IP            printer LAN IP (required unless BAMBU_MOCK=1)
    BAMBU_SERIAL        printer serial number (required unless BAMBU_MOCK=1)
    BAMBU_ACCESS_CODE   LAN access code, 8 digits (required unless BAMBU_MOCK=1)
    API_TOKEN           shared secret; leave empty or ``auto`` to generate one
    API_TOKEN_FILE      where a generated token is stored (default ./data/api_token)
    PORT                listen port (default 8080)
    BAMBU_POLL          snapshot refresh seconds (default 1.0)
    BAMBU_MOCK          set to 1 to serve simulated data (no printer needed)
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException, status

from bambu_client import BambuClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
_LOGGER = logging.getLogger("bambu_bridge")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_flag(name: str) -> bool:
    return _env(name).lower() in {"1", "true", "yes", "on"}


def _resolve_token() -> tuple[str, str]:
    """Return (token, source). Generates and persists one when unset."""
    configured = _env("API_TOKEN")

    if configured and configured.lower() != "auto":
        return configured, "API_TOKEN environment variable"

    token_file = _env("API_TOKEN_FILE", os.path.join(os.getcwd(), "data", "api_token"))

    try:
        with open(token_file, encoding="utf-8") as handle:
            existing = handle.read().strip()
        if existing:
            return existing, f"generated token file {token_file}"
    except OSError:
        pass

    token = secrets.token_hex(32)

    try:
        os.makedirs(os.path.dirname(token_file) or ".", exist_ok=True)
        with open(token_file, "w", encoding="utf-8") as handle:
            handle.write(token)
        os.chmod(token_file, 0o600)
        return token, f"newly generated token saved to {token_file}"
    except OSError as error:
        _LOGGER.warning("could not persist generated token to %s: %s", token_file, error)
        return token, "newly generated token (not persisted)"


MOCK = _env_flag("BAMBU_MOCK")
API_TOKEN, API_TOKEN_SOURCE = _resolve_token()

client = BambuClient(
    printer_ip=_env("BAMBU_IP"),
    access_code=_env("BAMBU_ACCESS_CODE"),
    serial=_env("BAMBU_SERIAL"),
    poll_seconds=float(_env("BAMBU_POLL", "1.0") or "1.0"),
    mock=MOCK,
)

app = FastAPI(title="Bambu Bridge", version="1.0.0")


def _validate_config() -> None:
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


def _print_token_banner() -> None:
    line = "=" * 72
    _LOGGER.info(line)
    _LOGGER.info("Bambu Bridge API token (%s)", API_TOKEN_SOURCE)
    _LOGGER.info("")
    _LOGGER.info("    %s", API_TOKEN)
    _LOGGER.info("")
    _LOGGER.info("Paste it into: Preferences -> Bambu Lab -> Bearer token")
    _LOGGER.info(line)


@app.on_event("startup")
def _startup() -> None:
    _validate_config()
    _LOGGER.info("starting bambu bridge (mock=%s)", MOCK)
    _print_token_banner()
    client.start()


@app.on_event("shutdown")
def _shutdown() -> None:
    client.stop()


@app.get("/")
def root() -> dict:
    return {
        "service": "bambu-bridge",
        "ok": True,
        "mock": MOCK,
        "endpoints": ["/health", "/status"],
    };


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
