import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import * as chrono from "chrono-node";
import { embedText, cosineSimilarity } from "./embedder";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "agent.db"));
db.pragma("journal_mode = WAL");

// Core messages table + FTS5 full-text index
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sources_json TEXT DEFAULT '[]',
    embedding_json TEXT DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content_rowid='id'
  );
`);

export interface StoredMessage {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  sources_json: string;
  created_at: string;
  matchReason?: string;
}

export async function saveMessage(params: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  sources?: any[];
  createdAt?: string; // Supports backdating for testing temporal memory
}): Promise<StoredMessage> {
  const createdAt = params.createdAt || new Date().toISOString();
  const embedding = await embedText(params.content);

  const stmt = db.prepare(`
    INSERT INTO messages (session_id, role, content, sources_json, embedding_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    params.sessionId,
    params.role,
    params.content,
    JSON.stringify(params.sources || []),
    JSON.stringify(embedding),
    createdAt
  );

  const rowId = Number(info.lastInsertRowid);
  db.prepare(`INSERT INTO messages_fts(rowid, content) VALUES (?, ?)`).run(
    rowId,
    params.content
  );

  return {
    id: rowId,
    session_id: params.sessionId,
    role: params.role,
    content: params.content,
    sources_json: JSON.stringify(params.sources || []),
    created_at: createdAt,
  };
}

/**
 * 3-Layer Hybrid Episodic Memory Retrieval:
 * 1. Temporal Layer (chrono-node parses "Monday", "3 November", "Last Tuesday")
 * 2. Lexical Layer (SQLite FTS5 BM25 keyword match)
 * 3. Semantic Layer (IBM Granite R2 ONNX cosine similarity)
 */
export async function retrieveEpisodicMemory(
  userQuery: string,
  referenceNow: Date = new Date()
): Promise<{ memories: StoredMessage[]; telemetry: string[] }> {
  const telemetry: string[] = [];
  const scoredMap = new Map<number, { msg: StoredMessage; score: number; reasons: Set<string> }>();

  const addCandidate = (msg: StoredMessage, score: number, reason: string) => {
    const existing = scoredMap.get(msg.id);
    if (existing) {
      existing.score += score;
      existing.reasons.add(reason);
    } else {
      scoredMap.set(msg.id, { msg, score, reasons: new Set([reason]) });
    }
  };

  // LAYER 1: Temporal Date Extraction (chrono-node)
  const parsedDates = chrono.parse(userQuery, referenceNow, { forwardDate: false });
  for (const parsed of parsedDates) {
    const targetDate = parsed.start.date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const dateLabel = dayStart.toISOString().split("T")[0];
    telemetry.push(`Temporal match: "${parsed.text}" → ${dateLabel}`);

    const rows = db
      .prepare(
        `SELECT id, session_id, role, content, sources_json, created_at
         FROM messages
         WHERE created_at BETWEEN ? AND ?
         ORDER BY created_at ASC`
      )
      .all(dayStart.toISOString(), dayEnd.toISOString()) as StoredMessage[];

    for (const r of rows) {
      addCandidate(r, 10.0, `Date Match (${dateLabel})`);
    }
  }

  // LAYER 2: SQLite FTS5 Keyword Search
  const stopWords = new Set([
    "what", "did", "ask", "you", "the", "and", "for", "has", "any", "them",
    "changed", "since", "then", "today", "still", "correct", "answer", "last",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "november", "shortlisted", "about", "our", "from", "with", "have", "that",
  ]);

  const keywords = userQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  if (keywords.length > 0) {
    const ftsQuery = keywords.slice(0, 6).join(" OR ");
    try {
      const ftsRows = db
        .prepare(
          `SELECT m.id, m.session_id, m.role, m.content, m.sources_json, m.created_at
           FROM messages_fts f
           JOIN messages m ON f.rowid = m.id
           WHERE messages_fts MATCH ?
           LIMIT 12`
        )
        .all(ftsQuery) as StoredMessage[];

      if (ftsRows.length > 0) {
        telemetry.push(`FTS5 keyword match: [${keywords.slice(0, 4).join(", ")}]`);
      }
      for (const r of ftsRows) {
        addCandidate(r, 4.0, "Keyword Match");
      }
    } catch {
      // Ignore malformed FTS syntax
    }
  }

  // LAYER 3: IBM Granite R2 ONNX Vector Similarity
  const queryVec = await embedText(userQuery);
  if (queryVec.length > 0) {
    const allRows = db
      .prepare(
        `SELECT id, session_id, role, content, sources_json, embedding_json, created_at
         FROM messages
         ORDER BY created_at DESC
         LIMIT 200`
      )
      .all() as (StoredMessage & { embedding_json: string })[];

    const vecScored = allRows
      .map((row) => {
        const vec = JSON.parse(row.embedding_json || "[]") as number[];
        const sim = cosineSimilarity(queryVec, vec);
        return { row, sim };
      })
      .filter((item) => item.sim > 0.38)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 6);

    if (vecScored.length > 0) {
      telemetry.push(
        `Granite-R2 vector recall: top cosine=${vecScored[0].sim.toFixed(2)}`
      );
    }

    for (const item of vecScored) {
      addCandidate(item.row, item.sim * 5.0, `Vector Sim (${item.sim.toFixed(2)})`);
      // Also pull the adjacent assistant response if a user question matched
      const nextTurn = db
        .prepare(
          `SELECT id, session_id, role, content, sources_json, created_at
           FROM messages
           WHERE id = ?`
        )
        .get(item.row.id + 1) as StoredMessage | undefined;
      if (nextTurn && nextTurn.session_id === item.row.session_id) {
        addCandidate(nextTurn, item.sim * 4.5, "Paired Turn");
      }
    }
  }

  const ranked = Array.from(scoredMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .sort((a, b) => a.msg.created_at.localeCompare(b.msg.created_at))
    .map((entry) => ({
      ...entry.msg,
      matchReason: Array.from(entry.reasons).join(" + "),
    }));

  return { memories: ranked, telemetry };
}

export function getAllMessages(limit = 100): StoredMessage[] {
  return db
    .prepare(
      `SELECT id, session_id, role, content, sources_json, created_at
       FROM messages
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(limit) as StoredMessage[];
}

export function clearMessages() {
  db.exec(`DELETE FROM messages; DELETE FROM messages_fts;`);
}