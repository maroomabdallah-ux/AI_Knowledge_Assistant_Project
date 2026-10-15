
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from psycopg.rows import dict_row
from typing import Optional

from app.services.database_service import get_connection
from app.routers.auth_router import get_current_user
from fastapi import APIRouter, Depends, HTTPException, status


router = APIRouter(
    prefix="/api/conversations",
    tags=["Conversations"]
)


class CreateConversationRequest(BaseModel):
    title: str = Field(
        default="New conversation",
        min_length=1,
        max_length=200
    )


class ConversationResponse(BaseModel):
    id: int
    user_id: int
    title: str
    document_id: Optional[int] = None
    document_name: Optional[str] = None


@router.post(
    "",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED
)
def create_conversation(
    data: CreateConversationRequest,
    current_user: dict = Depends(get_current_user)
):
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                INSERT INTO conversations (user_id, title)
                VALUES (%s, %s)
                RETURNING id, user_id, title, document_id
                """,
                (
                    current_user["id"],
                    data.title
                )
            )

            conversation = cur.fetchone()

    return conversation

@router.get("", response_model=list[ConversationResponse])
def get_my_conversations(
    current_user: dict = Depends(get_current_user)
):
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT c.id, c.user_id, c.title, c.document_id,
                       d.filename AS document_name
                FROM conversations c
                LEFT JOIN documents d ON d.id = c.document_id
                WHERE c.user_id = %s
                ORDER BY c.created_at DESC, c.id DESC
                """,
                (current_user["id"],)
            )

            conversations = cur.fetchall()

    return conversations

class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    sources: list = Field(default_factory=list)
    a2ui: list = Field(default_factory=list)
    document_id: Optional[int] = None


@router.get(
    "/{conversation_id}/messages",
    response_model=list[MessageResponse]
)
def get_conversation_messages(
    conversation_id: int,
    current_user: dict = Depends(get_current_user)
):
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT id, document_id
                FROM conversations
                WHERE id = %s AND user_id = %s
                """,
                (conversation_id, current_user["id"])
            )

            conversation = cur.fetchone()
            if conversation is None:
                raise HTTPException(
                    status_code=404,
                    detail="Conversation not found"
                )

            cur.execute(
                """
                SELECT id, conversation_id, role,
                       content, sources, a2ui
                FROM messages
                WHERE conversation_id = %s
                ORDER BY created_at ASC, id ASC
                """,
                (conversation_id,)
            )

            messages = cur.fetchall()
            for message in messages:
                message["document_id"] = conversation["document_id"]
    return messages


@router.get("/documents/list")
def list_documents(current_user: dict = Depends(get_current_user)):
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """SELECT d.id, d.filename AS name,
                          COUNT(DISTINCT c.page_number) AS pages,
                          0 AS characters
                   FROM documents d
                   LEFT JOIN document_chunks c ON c.document_id = d.id
                   WHERE d.user_id = %s
                   GROUP BY d.id ORDER BY d.id DESC""",
                (current_user["id"],),
            )
            return cur.fetchall()
