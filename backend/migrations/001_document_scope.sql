-- Associate uploaded documents and conversations with their owner and scope.
ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES documents(id);

CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);
CREATE INDEX IF NOT EXISTS conversations_document_id_idx ON conversations(document_id);
