import { db } from "./index.js";

export interface Conversation {
  id: number;
  title: string | null;
  started_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: number;
  conversation_id: number;
  role: "user" | "assistant" | "tool";
  content: string; // JSON-encoded content blocks
  created_at: string;
}

export const conversations = {
  create(title: string | null = null): Conversation {
    const info = db
      .prepare("INSERT INTO conversations (title) VALUES (?)")
      .run(title);
    return db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(info.lastInsertRowid) as Conversation;
  },

  get(id: number): Conversation | null {
    return (
      (db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation | undefined) ??
      null
    );
  },

  list(limit = 50): Conversation[] {
    return db
      .prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as Conversation[];
  },

  setTitle(id: number, title: string): void {
    db.prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?").run(
      title,
      id,
    );
  },

  touch(id: number): void {
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(id);
  },

  addMessage(
    conversationId: number,
    role: StoredMessage["role"],
    content: unknown,
  ): StoredMessage {
    const info = db
      .prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)")
      .run(conversationId, role, JSON.stringify(content));
    this.touch(conversationId);
    return db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(info.lastInsertRowid) as StoredMessage;
  },

  messages(conversationId: number): StoredMessage[] {
    return db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC")
      .all(conversationId) as StoredMessage[];
  },

  delete(id: number): void {
    // ON DELETE CASCADE in schema removes messages
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  },
};
