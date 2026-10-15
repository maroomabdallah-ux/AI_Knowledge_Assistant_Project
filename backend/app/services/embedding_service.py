
import os
from openai import AsyncOpenAI


def get_client() -> AsyncOpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for document embeddings")
    return AsyncOpenAI(api_key=api_key)


async def create_embedding(text: str) -> list[float]:
    response = await get_client().embeddings.create(
        model="text-embedding-3-small",
        input=text
    )

    return response.data[0].embedding

async def create_embeddings(chunks: list[str]) -> list[list[float]]:
    if not chunks:
        return []

    response = await get_client().embeddings.create(
        model="text-embedding-3-small",
        input=chunks
    )

    ordered = sorted(response.data, key=lambda item: item.index)

    return [item.embedding for item in ordered]
