
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from psycopg.rows import dict_row
from psycopg.errors import UniqueViolation

from app.services.database_service import get_connection
from app.services.auth_service import hash_password
from datetime import datetime, timedelta, timezone
import os
import jwt

from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jwt.exceptions import InvalidTokenError

router = APIRouter(
    prefix="/api/auth",
    tags=["Authentication"]
)


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str


from app.services.auth_service import verify_password


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


def create_access_token(user_id: int) -> str:
    secret_key = os.getenv("JWT_SECRET_KEY")

    if not secret_key:
        raise RuntimeError("JWT_SECRET_KEY is not configured")

    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)

    payload = {
        "sub": str(user_id),
        "exp": expires_at,
    }

    return jwt.encode(payload, secret_key, algorithm="HS256")


@router.post("/login", response_model=TokenResponse)
def login_user(data: LoginRequest):
    email = str(data.email).strip().lower()

    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT id, email, password_hash
                FROM users
                WHERE email = %s
                """,
                (email,)
            )
            user = cur.fetchone()

    if not user or not verify_password(
        data.password, user["password_hash"]
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    token = create_access_token(user["id"])

    return TokenResponse(access_token=token)


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED
)
def register_user(data: RegisterRequest):
    email = str(data.email).strip().lower()

    hashed_password = hash_password(data.password)

    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                INSERT INTO users (name, email, password_hash)
                VALUES (%s, %s, %s)
                ON CONFLICT (email) DO NOTHING
                RETURNING id, name, email ,role
                """,
                (
                    data.name.strip(),
                    email,
                    hashed_password
                )
            )

            user = cur.fetchone()

    if user is None:
        raise HTTPException(
            status_code=409,
            detail="Email already registered"
        )

    return user

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    token = credentials.credentials
    secret_key = os.getenv("JWT_SECRET_KEY")

    if not secret_key:
        raise RuntimeError("JWT_SECRET_KEY is not configured")

    try:
        payload = jwt.decode(
            token,
            secret_key,
            algorithms=["HS256"]
        )

        user_id = int(payload["sub"])

    except (InvalidTokenError, KeyError, ValueError, TypeError):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token"
        )

    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT id, name, email ,role
                FROM users
                WHERE id = %s
                """,
                (user_id,)
            )
            user = cur.fetchone()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="User not found"
        )

    return user


def require_admin(
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )

    return current_user


@router.get("/me", response_model=UserResponse)
def get_my_profile(
    current_user: dict = Depends(get_current_user)
):
    return current_user



@router.get("/admin-test")
def admin_test(
    current_user: dict = Depends(require_admin)
):
    return {
        "message": "Admin access granted",
        "name": current_user["name"],
        "role": current_user["role"]
    }
