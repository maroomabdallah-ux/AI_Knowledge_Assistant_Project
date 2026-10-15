
from fastapi import APIRouter, Depends
from fastapi import Query
from psycopg.rows import dict_row
import os
from urllib.request import urlopen
from urllib.error import URLError, HTTPError

from app.routers.auth_router import require_admin
from app.services.database_service import get_connection


router = APIRouter(
    prefix="/api/admin",
    tags=["Admin"],
    dependencies=[Depends(require_admin)]
)


@router.get("/stats")
def get_admin_stats():
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT COUNT(*) AS total FROM users")
            total_users = cur.fetchone()["total"]

            cur.execute("SELECT COUNT(*) AS total FROM conversations")
            total_conversations = cur.fetchone()["total"]

            cur.execute("SELECT COUNT(*) AS total FROM messages")
            total_messages = cur.fetchone()["total"]

            cur.execute("SELECT COUNT(*) AS total FROM documents")
            total_documents = cur.fetchone()["total"]

    return {
        "total_users": total_users,
        "total_conversations": total_conversations,
        "total_messages": total_messages,
        "total_documents": total_documents
    }


@router.get("/users")
def get_admin_users(
    search: str = Query(default="", max_length=120),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Return a bounded, non-sensitive user listing for admin review."""
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """SELECT id, name, email, role
                   FROM users
                   WHERE (%s = '' OR name ILIKE %s OR email ILIKE %s)
                   ORDER BY id DESC
                   LIMIT %s OFFSET %s""",
                (search, "%" + search + "%", "%" + search + "%", limit, offset),
            )
            users = cur.fetchall()
            cur.execute(
                """SELECT COUNT(*) AS total FROM users
                   WHERE (%s = '' OR name ILIKE %s OR email ILIKE %s)""",
                (search, "%" + search + "%", "%" + search + "%"),
            )
            total = cur.fetchone()["total"]

    return {"items": users, "total": total, "limit": limit, "offset": offset}


@router.get("/documents")
def get_admin_documents(
    search: str = Query(default="", max_length=200),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """SELECT d.id, d.filename, d.user_id AS owner_id,
                          COUNT(DISTINCT c.page_number) AS page_count,
                          COUNT(c.chunk_index) AS chunk_count
                   FROM documents d
                   LEFT JOIN document_chunks c ON c.document_id = d.id
                   WHERE d.filename ILIKE %s
                   GROUP BY d.id
                   ORDER BY d.id DESC
                   LIMIT %s OFFSET %s""",
                ("%" + search + "%", limit, offset),
            )
            items = cur.fetchall()
            cur.execute(
                "SELECT COUNT(*) AS total FROM documents WHERE filename ILIKE %s",
                ("%" + search + "%",),
            )
            total = cur.fetchone()["total"]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


def _probe_service(url: str, path: str) -> bool:
    try:
        with urlopen(url.rstrip("/") + path, timeout=1.5) as response:
            return 200 <= response.status < 400
    except (URLError, HTTPError, TimeoutError, OSError):
        return False


@router.get("/monitoring/status")
def get_monitoring_status():
    prometheus_url = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
    grafana_url = os.getenv("GRAFANA_URL", "http://localhost:3000")
    return {
        "api": True,
        "prometheus": _probe_service(prometheus_url, "/-/healthy"),
        "grafana": _probe_service(grafana_url, "/api/health"),
        "prometheus_url": prometheus_url,
        "grafana_url": grafana_url,
    }
