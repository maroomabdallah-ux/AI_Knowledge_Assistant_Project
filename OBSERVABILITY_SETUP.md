# Observability setup — Phase 2

This phase adds HTTP metrics, Prometheus, Grafana, and a provisioned API performance dashboard. Logs, distributed traces, AI token/cost accounting, and the other dashboards are later phases and are not configured yet.

## Architecture

```text
FastAPI :8000/metrics  ->  Prometheus :9090  ->  Grafana :3000
                                  |
                                  +-- scrapes every 15 seconds
```

The Prometheus and Grafana containers use the `observability` Compose profile, so they can be started and stopped independently from PostgreSQL. Prometheus targets the host machine at `host.docker.internal:8000`, which works with Docker Desktop on macOS and Windows.

## Start

Install the backend requirements if needed, then start FastAPI from `backend/` so Docker can reach its metrics endpoint:

```sh
set -a
source .env
set +a
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

In a second terminal, from the project root, set a local Grafana password and start only the monitoring containers:

```sh
GRAFANA_ADMIN_USER=admin GRAFANA_ADMIN_PASSWORD='choose-a-local-password' \
  docker compose --profile observability up -d prometheus grafana
```

Do not reuse this local password in production. Compose binds the monitoring UIs to `127.0.0.1`.

## URLs

- Grafana: <http://localhost:3000> (login from the environment variables above)
- Prometheus: <http://localhost:9090>
- FastAPI metrics: <http://localhost:8000/metrics>
- FastAPI health: <http://localhost:8000/health>

Grafana provisions the Prometheus data source and **AI Knowledge Assistant — API Performance** dashboard on startup.

## Verify collection

1. Open `/metrics` and confirm `http_requests_total` and `http_request_duration_highr_seconds_bucket` are present.
2. Generate a few requests, for example:

   ```sh
   curl http://localhost:8000/health
   curl http://localhost:8000/api/auth/me
   ```

   The unauthenticated profile request should return an HTTP error and will be counted as an API response.
3. Open Prometheus **Status → Targets** and confirm `ai-knowledge-assistant` is `UP`.
4. Open Grafana, select the provisioned API Performance dashboard, and set a time range that includes the requests.

The dashboard uses the instrumentator's real metrics: request totals and grouped status codes, request rate, histogram-based p95/p99 latency, average latency, and average latency by route. No user ID, email, token, prompt, or document content is used as a metric label. Initial graphs can be empty until Prometheus has scraped the backend and requests have occurred.

## Stop

```sh
docker compose --profile observability stop grafana prometheus
```

To remove the containers while preserving metrics and Grafana configuration, use `docker compose --profile observability down`. Persistent data volumes remain. Do not pass `-v` unless you intend to delete that data.

## Troubleshooting

- **Target is DOWN:** check that FastAPI is running on port 8000 and started with `--host 0.0.0.0`; check `docker compose --profile observability logs prometheus`.
- **Dashboard is empty:** confirm the target is UP, wait at least one scrape interval, generate requests, and widen the Grafana time range.
- **Grafana credentials rejected:** the Grafana database persists in `grafanadata`. Changing environment variables does not reset an existing Grafana password. Change it in Grafana or, only for a disposable local setup, remove the data volume deliberately.
- **Ports are in use:** change the host-side ports in `docker-compose.yml`; keep the `127.0.0.1` binding for local-only access.

## Security and limitations

This is a local development setup. The Prometheus endpoint is unauthenticated so the local scraper can read it; restrict access to the FastAPI host port with your host firewall and do not expose it publicly. Use a private network, authentication, TLS, and managed secrets before deploying monitoring or the app outside a trusted development machine. The dashboard's latency percentiles are aggregate metrics; per-route histograms are intentionally kept low-cardinality.
