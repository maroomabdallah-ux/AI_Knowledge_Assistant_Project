from typing import List, Optional

def chunk_text(
    text: str,
    chunk_size: int = 800,
    overlap: int = 150
) -> list[str]:

    if chunk_size <= 0 or not 0 <= overlap < chunk_size:
        raise ValueError("Invalid chunk settings")

    text = " ".join(text.split())

    if not text:
        return []

    chunks = []
    start = 0

    while start < len(text):
        end = min(start + chunk_size, len(text))

        chunk = text[start:end]
        chunks.append(chunk)

        if end == len(text):
            break

        start = end - overlap

    return chunks

def chunk_pdf_pages(reader, page_texts: Optional[List[str]] = None):
    all_chunks = []

    for page_number, page in enumerate(reader.pages, start=1):
        text = page_texts[page_number - 1] if page_texts else (page.extract_text() or "")
        chunks = chunk_text(text)

        for chunk in chunks:
            all_chunks.append({
                "content": chunk,
                "page_number": page_number
            })

    return all_chunks
from typing import List, Optional

