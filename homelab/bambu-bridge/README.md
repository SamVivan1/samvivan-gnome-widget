# Bambu Bridge

Small self-hosted service that keeps a persistent local MQTT connection to a
Bambu Lab printer (A1 / A1 mini / P1 / X1) and exposes its live status as JSON
over HTTP. Run it on a homelab host next to the printer and publish it through a
Cloudflare Tunnel so the **Desktop Widget** extension can display print progress
from anywhere.

```
printer --MQTT(LAN)--> bambu-bridge --HTTPS+token--> cloudflared --> widget
```

## Requirements

- Printer reachable on the LAN with **LAN mode** enabled (Settings → Network on
  the printer), or **Developer Mode** on newer firmware. You also need the LAN
  **access code** and the printer **serial number** (both shown in the network
  settings).
- Docker + Docker Compose on the homelab host.
- For A1 / A1 mini: local MQTT only works in LAN mode / Developer Mode.

## Quick start

```bash
cd homelab/bambu-bridge
cp .env.example .env
# edit .env: BAMBU_IP, BAMBU_SERIAL, BAMBU_ACCESS_CODE, API_TOKEN
docker compose up -d --build
```

Test without a printer first:

```bash
BAMBU_MOCK=1 docker compose up -d --build
curl -s -H "Authorization: Bearer $(grep API_TOKEN .env | cut -d= -f2)" \
  http://localhost:8080/status | jq
```

## Endpoints

| Method | Path      | Auth         | Description                          |
| ------ | --------- | ------------ | ------------------------------------ |
| GET    | `/health` | Bearer token | Liveness + MQTT connection state     |
| `GET`  | `/status` | Bearer token | Normalized printer + job status JSON |

Auth header: `Authorization: Bearer <API_TOKEN>`.

### `/status` response

```json
{
  "ok": true,
  "connected": true,
  "updated": 1730000000,
  "printer": {"name": "A1 mini", "model": "A1 mini", "online": true, "wifi": "-56dBm"},
  "job": {
    "state": "RUNNING",
    "file": "benchy.gcode.3mf",
    "progress": 42,
    "remaining_min": 37,
    "layer": 85,
    "total_layers": 200,
    "speed_level": 2,
    "speed": "Sport",
    "error_code": 0
  },
  "temperatures": {
    "nozzle": 218.5, "nozzle_target": 220.0,
    "bed": 59.4, "bed_target": 60.0, "chamber": null
  },
  "filament": {"ams": [{"unit": 0, "slot": 0, "type": "PLA", "color": "#e03030", "active": true}], "active": 0}
}
```

## Expose through Cloudflare Tunnel

With `cloudflared` installed on the same host:

```bash
cloudflared tunnel login
cloudflared tunnel create bambu-bridge
cloudflared tunnel route dns bambu-bridge bambu.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: bambu-bridge
credentials-file: /home/you/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: bambu.example.com
    service: http://localhost:8080
  - service: http_status:404
```

```bash
cloudflared tunnel run bambu-bridge
```

Then in the widget preferences set the endpoint to
`https://bambu.example.com` and paste the same `API_TOKEN`.

## Security notes

- Always send the `Authorization: Bearer` token; the tunnel alone does not
  authenticate clients. Consider adding **Cloudflare Access** on top.
- The token and access code are secrets. Do not commit `.env`.
- Treat the endpoint as read-only public data; it does not accept commands.

## Run without Docker

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
set -a; . ./.env; set +a
uvicorn app:app --host 0.0.0.0 --port "${PORT:-8080}"
```
