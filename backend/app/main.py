from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text
from app.services.llm_service import answer_question
from fastapi import UploadFile, File, HTTPException
from pypdf import PdfReader
from io import BytesIO
import traceback
from typing import Optional
from app.services.chunking_service import chunk_text
from app.services.embedding_service import create_embedding
from app.services.embedding_service import create_embeddings
from app.services.database_service import save_document
from app.services.database_service import search_similar_chunks
from app.services.embedding_service import create_embedding
from app.services.rag_service import answer_with_rag
from app.services.chunking_service import chunk_pdf_pages
from app.services.chunking_service import chunk_text
from app.routers.auth_router import router as auth_router
from app.routers.conversation_router import router as conversation_router
from fastapi import Depends
from psycopg.rows import dict_row
from app.services.database_service import get_connection
from app.routers.auth_router import get_current_user
from app.routers.admin_router import router as admin_router
from contextlib import asynccontextmanager
from prometheus_fastapi_instrumentator import Instrumentator, metrics


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Keep the document scope schema in sync before serving API requests.
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)"
            )
            cur.execute(
                "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES documents(id)"
            )
            cur.execute(
                "ALTER TABLE messages ADD COLUMN IF NOT EXISTS a2ui JSONB NOT NULL DEFAULT '[]'::jsonb"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS conversations_document_id_idx ON conversations(document_id)"
            )
        conn.commit()
    yield


app = FastAPI(title="AI Knowledge Assistant", lifespan=lifespan)
Instrumentator(
    should_group_status_codes=True,
    should_ignore_untemplated=True,
    excluded_handlers=[r"^/metrics$", r"^/health$"],
    should_instrument_requests_inprogress=True,
).add(metrics.default()).instrument(app).expose(app, include_in_schema=False)
app.include_router(auth_router)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(conversation_router)
app.include_router(admin_router)


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[int] = None
    document_id: Optional[int] = None

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/chat")
async def chat(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user)
):
    if request.conversation_id is None:
        raise HTTPException(
            status_code=400,
            detail="conversation_id is required"
        )

    conversation_id = request.conversation_id

    # Verify that this conversation belongs to the logged-in user
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

    # A conversation is bound to its first selected document.
    active_document_id = conversation["document_id"]
    if active_document_id is None:
        if request.document_id is None:
            raise HTTPException(status_code=400, detail="Select a document before chatting")
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM documents WHERE id = %s AND user_id = %s",
                    (request.document_id, current_user["id"]),
                )
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail="Document not found")
                cur.execute(
                    "UPDATE conversations SET document_id = %s WHERE id = %s AND document_id IS NULL",
                    (request.document_id, conversation_id),
                )
                conn.commit()
        active_document_id = request.document_id
    elif request.document_id is not None and request.document_id != active_document_id:
        raise HTTPException(status_code=409, detail="Start a new conversation to change the document")

    result = await answer_with_rag(
        request.message, active_document_id, current_user["id"]
    )

    # Save the question and AI answer together
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO messages
                    (conversation_id, role, content)
                VALUES (%s, %s, %s)
                """,
                (conversation_id, "user", request.message)
            )

            cur.execute(
                """
                INSERT INTO messages
                    (conversation_id, role, content, sources, a2ui)
                VALUES (%s, %s, %s, %s::jsonb, %s::jsonb)
                """,
                (
                    conversation_id,
                    "assistant",
                    result["answer"],
                    __import__("json").dumps(result.get("sources", [])),
                    __import__("json").dumps(result.get("a2ui", [])),
                )
            )

            cur.execute(
                """
                UPDATE conversations
                SET updated_at = NOW()
                WHERE id = %s AND user_id = %s
                """,
                (conversation_id, current_user["id"])
            )

    return result



@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):

    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are allowed"
        )

    contents = await file.read()

    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="File is too large. Maximum size is 10 MB."
        )

    try:
        reader = PdfReader(BytesIO(contents))

        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                raise ValueError(
                    "PDF is encrypted and requires a password"
                )

        page_texts = [(page.extract_text() or "").strip() for page in reader.pages]
        # pypdf can return short/empty text for image-only pages. Only invoke OCR
        # when the PDF has almost no extractable text overall, not for every short page.
        extracted_chars = sum(len(text) for text in page_texts)
        minimum_text_chars = max(20, len(page_texts) * 8)
        if extracted_chars < minimum_text_chars:
            try:
                import pytesseract
                from pdf2image import convert_from_bytes
                from PIL import ImageOps
            except ImportError as error:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"لم يتمكن pypdf من استخراج نص كافٍ ({extracted_chars} حرفًا من "
                        f"{len(page_texts)} صفحة). إذا كان الملف مصوّرًا، ثبّت pytesseract "
                        "وpdf2image وPillow، إضافة إلى Tesseract وPoppler."
                    )
                ) from error

            scanned_pages = [i for i, text in enumerate(page_texts) if len(text) < 8]
            for index in scanned_pages:
                image_pages = convert_from_bytes(
                    contents, dpi=180, first_page=index + 1,
                    last_page=index + 1, thread_count=1,
                )
                # Arabic and English OCR are both enabled by default.
                page_texts[index] = pytesseract.image_to_string(
                    ImageOps.grayscale(image_pages[0]), lang="ara+eng", config="--psm 6"
                ).strip()

        text = "\n".join(page_texts)
        chunks = chunk_pdf_pages(reader, page_texts)

        if not chunks:
            raise HTTPException(
                status_code=422,
                detail="لم أتمكن من قراءة نص من الملف. تأكد من وضوح الصور وتثبيت بيانات اللغتين العربية والإنجليزية في Tesseract."
            )

        embeddings = await create_embeddings(
         [chunk["content"] for chunk in chunks]
)
        document_id = save_document(
            filename=file.filename,
            chunks=chunks,
            embeddings=embeddings,
            user_id=current_user["id"],
        )

        return {
            "document_id": document_id,
            "filename": file.filename,
            "pages": len(reader.pages),
            "characters": len(text),
            "total_chunks": len(chunks),
            "stored_embeddings": len(embeddings),
            "embedding_dimensions": len(embeddings[0]),
            "message": "Document stored successfully"
        }


    except HTTPException:
        raise
    except Exception as error:
        traceback.print_exc()

        raise HTTPException(
            status_code=400,
            detail=f"{type(error).__name__}: {str(error)}"
        )


@app.get("/api/documents")
def list_documents(current_user: dict = Depends(get_current_user)):
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """SELECT d.id, d.filename AS name, COUNT(DISTINCT c.page_number) AS pages
                   FROM documents d LEFT JOIN document_chunks c ON c.document_id = d.id
                   WHERE d.user_id = %s GROUP BY d.id ORDER BY d.id DESC""",
                (current_user["id"],),
            )
            return cur.fetchall()


@app.post("/api/search")
async def search_documents(request: ChatRequest, current_user: dict = Depends(get_current_user)):
    query_embedding = await create_embedding(request.message)

    results = search_similar_chunks(
        query_embedding=query_embedding,
        limit=3,
        document_id=request.document_id,
        user_id=current_user["id"],
    )

    return {
        "question": request.message,
        "results": results
    }
