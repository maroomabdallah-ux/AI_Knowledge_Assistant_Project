# AI Knowledge Assistant

A learning-oriented React + FastAPI starter for a document-based AI assistant.

## Implemented
- React + TypeScript chat interface
- FastAPI health and chat endpoints
- Optional OpenAI model call via server-side API key
- PostgreSQL with pgvector Docker service (prepared, not yet connected)

## Planned (not implemented yet)
- PDF uploads, chunking, embeddings, vector search and RAG
- Conversation persistence and streaming
- OpenTelemetry instrumentation, Prometheus, Tempo, Grafana dashboards

## Requirements
Python 3.11+, Node.js 20+, Docker Desktop, optional OpenAI API key.

## Start
1. `docker compose up -d`
2. `cd backend && python3 -m venv .venv && source .venv/bin/activate`
3. `pip install -r requirements.txt`
4. `cp .env.example .env` and set `OPENAI_API_KEY` if needed.
5. `uvicorn app.main:app --reload`
6. In another terminal: `cd frontend && npm install && npm run dev`
7. Open http://localhost:5173

Backend API documentation: http://localhost:8000/docs

Note: Backend currently reads environment variables from the shell. To load the
.env file automatically, use `set -a; source .env; set +a` before running uvicorn.
Never commit real API keys.

### OCR for scanned PDFs (macOS)

Scanned PDFs need Tesseract and Poppler in addition to the Python packages. Install
the system tools and Arabic/English language data with Homebrew:

```bash
brew install tesseract tesseract-lang poppler
```

Then, from the `backend` directory, install Python dependencies into the same
virtual environment used to run Uvicorn and restart the server:

```bash
source .venv/bin/activate
python -m pip install -r requirements.txt
```

The OCR upload path uses `ara+eng` and converts scanned pages to images with
Poppler. If Homebrew is not installed, install it first from https://brew.sh.

## Architecture
React -> FastAPI -> LLM.
Next: documents -> chunks -> embeddings -> pgvector -> retrieval -> LLM.
Monitoring will be added after RAG is working.
