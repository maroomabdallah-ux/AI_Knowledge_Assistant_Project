import os

from google import genai
from google.genai import types


def get_client():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required for document embeddings")
    return genai.Client(api_key=api_key)


def _embedding_config(task_type):
    return types.EmbedContentConfig(
        task_type=task_type,
        output_dimensionality=1536,
    )


async def create_embedding(text: str) -> list[float]:
    response = await get_client().aio.models.embed_content(
        model=os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001"),
        contents=text,
        config=_embedding_config("RETRIEVAL_QUERY"),
    )
    return list(response.embeddings[0].values)


async def create_embeddings(chunks: list[str]) -> list[list[float]]:
    if not chunks:
        return []
    response = await get_client().aio.models.embed_content(
        model=os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001"),
        contents=chunks,
        config=_embedding_config("RETRIEVAL_DOCUMENT"),
    )
    return [list(item.values) for item in response.embeddings]
