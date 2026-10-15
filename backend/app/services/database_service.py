import os
from typing import Optional
import psycopg
from pgvector.psycopg import register_vector

DATABASE_URL = os.getenv("DATABASE_URL")

def get_connection():
    conn = psycopg.connect(DATABASE_URL)
    register_vector(conn)
    return conn



def save_document(filename, chunks, embeddings, user_id):
    if len(chunks) != len(embeddings):
        raise ValueError("Chunks and embeddings count must match")

    with get_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO documents (filename, user_id)
                VALUES (%s, %s)
                RETURNING id
                """,
                (filename, user_id)
            )

            document_id = cursor.fetchone()[0]

            for index, (chunk, embedding) in enumerate(
                zip(chunks, embeddings)
            ):
                cursor.execute(
                    """
                    INSERT INTO document_chunks
                    (document_id, chunk_index, content,
                     embedding, page_number)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        document_id,
                        index,
                        chunk["content"],
                        embedding,
                        chunk["page_number"]
                    )
                )

        conn.commit()

    return document_id



def search_similar_chunks(
    query_embedding: list[float],
    limit: int = 3,
    document_id: Optional[int] = None,
    user_id: Optional[int] = None,
):
    with get_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
               SELECT
    d.filename,
    c.page_number,
    c.content,
    1 - (c.embedding <=> %s::vector) AS similarity
FROM document_chunks c
JOIN documents d
    ON c.document_id = d.id
WHERE c.page_number IS NOT NULL
  AND (%s IS NULL OR d.id = %s)
  AND d.user_id = %s
ORDER BY c.embedding <=> %s::vector
LIMIT %s
                """,
                (query_embedding, document_id, document_id, user_id,
                 query_embedding, limit)
            )

            rows = cursor.fetchall()

    return [
        {
            "filename": row[0],
            "page_number": row[1],
            "content": row[2],
            "similarity": float(row[3])
        }
        for row in rows
    ]
