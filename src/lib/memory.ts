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

export interface StoredSource {
  title: string;
  url: string;
  query?: string;
  provider?: string;
}

export interface StoredMessage {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  sources_json: string;
  created_at: string;
  matchReason?: string;
}

export interface ConsolidationResult {
  action: "inserted" | "consolidated";
  userRowId: number;
  assistantRowId: number;
  similarityScore?: number;
  matchedQueryPreview?: string;
}

export async function saveMessage(params: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  sources?: StoredSource[];
  createdAt?: string;
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
 * Normalize text for fast token-Jaccard intent comparison alongside Granite-R2 cosine similarity.
 */
function computeTokenOverlap(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  return intersection / Math.min(setA.size, setB.size);
}

/**
 * Smart Semantic Memory Consolidation (Upsert vs Insert):
 * Checks if a semantically equivalent or paraphrased user prompt already exists
 * within the same date window (or non-seed history).
 * - If cosine similarity >= 0.83 (or hybrid similarity + token overlap >= 0.80),
 *   it updates the existing User + Assistant pair in-place instead of creating duplicates!
 * - Never overwrites protected historical seed anchors on past dates when asked from today.
 */
export async function consolidateOrSaveTurn(params: {
  sessionId: string;
  userContent: string;
  assistantContent: string;
  sources?: StoredSource[];
  createdAt?: string;
}): Promise<ConsolidationResult> {
  const createdAt = params.createdAt || new Date().toISOString();
  const targetDay = createdAt.split("T")[0];
  const userVec = await embedText(params.userContent);

  // Pull existing user turns to check for same/similar intent
  const existingUsers = db
    .prepare(
      `SELECT id, session_id, role, content, embedding_json, created_at
       FROM messages
       WHERE role = 'user'
       ORDER BY created_at DESC
       LIMIT 150`
    )
    .all() as (StoredMessage & { embedding_json: string })[];

  let bestMatch: {
    row: StoredMessage & { embedding_json: string };
    score: number;
  } | null = null;

  for (const candidate of existingUsers) {
    const candidateDay = candidate.created_at.split("T")[0];

    // Protect historical baseline seeds on DIFFERENT dates from being overwritten by today's follow-up
    const isProtectedPastSeed =
      candidate.session_id.startsWith("seed-") && candidateDay !== targetDay;
    if (isProtectedPastSeed) continue;

    // Only consolidate turns from the same day OR non-dated general queries
    const sameDay = candidateDay === targetDay;
    if (!sameDay) continue;

    const candVec = JSON.parse(candidate.embedding_json || "[]") as number[];
    const cosSim =
      userVec.length && candVec.length
        ? cosineSimilarity(userVec, candVec)
        : 0;
    const tokenOverlap = computeTokenOverlap(
      params.userContent,
      candidate.content
    );

    // Hybrid semantic + lexical intent score
    const combinedScore = Math.max(
      cosSim,
      cosSim * 0.7 + tokenOverlap * 0.3
    );

    if (
      combinedScore >= 0.82 &&
      (!bestMatch || combinedScore > bestMatch.score)
    ) {
      bestMatch = { row: candidate, score: combinedScore };
    }
  }

  // If we found an existing memory with the same/similar intent -> CONSOLIDATE IN PLACE!
  if (bestMatch) {
    const existingUserId = bestMatch.row.id;

    // Update user turn timestamp & latest phrasing
    await updateMessage({
      id: existingUserId,
      role: "user",
      content: params.userContent,
      createdAt,
    });

    // Find the paired assistant turn right after existingUserId
    const pairedAssistant = db
      .prepare(
        `SELECT id FROM messages
         WHERE id > ? AND role = 'assistant'
         ORDER BY id ASC
         LIMIT 1`
      )
      .get(existingUserId) as { id: number } | undefined;

    let assistantRowId = existingUserId + 1;
    const replyTimestamp = new Date(
      new Date(createdAt).getTime() + 1000
    ).toISOString();

    if (pairedAssistant) {
      assistantRowId = pairedAssistant.id;
      const replyVec = await embedText(params.assistantContent);
      db.prepare(
        `UPDATE messages
         SET content = ?, sources_json = ?, embedding_json = ?, created_at = ?
         WHERE id = ?`
      ).run(
        params.assistantContent,
        JSON.stringify(params.sources || []),
        JSON.stringify(replyVec),
        replyTimestamp,
        assistantRowId
      );
      db.prepare(`DELETE FROM messages_fts WHERE rowid = ?`).run(
        assistantRowId
      );
      db.prepare(`INSERT INTO messages_fts(rowid, content) VALUES (?, ?)`).run(
        assistantRowId,
        params.assistantContent
      );
    } else {
      const savedReply = await saveMessage({
        sessionId: params.sessionId,
        role: "assistant",
        content: params.assistantContent,
        sources: params.sources,
        createdAt: replyTimestamp,
      });
      assistantRowId = savedReply.id;
    }

    return {
      action: "consolidated",
      userRowId: existingUserId,
      assistantRowId,
      similarityScore: Number((bestMatch.score * 100).toFixed(1)),
      matchedQueryPreview: bestMatch.row.content.slice(0, 80),
    };
  }

  // Otherwise, insert as a brand-new memory pair
  const savedUser = await saveMessage({
    sessionId: params.sessionId,
    role: "user",
    content: params.userContent,
    createdAt,
  });

  const savedAssistant = await saveMessage({
    sessionId: params.sessionId,
    role: "assistant",
    content: params.assistantContent,
    sources: params.sources,
    createdAt: new Date(new Date(createdAt).getTime() + 1000).toISOString(),
  });

  return {
    action: "inserted",
    userRowId: savedUser.id,
    assistantRowId: savedAssistant.id,
  };
}

export async function updateMessage(params: {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}): Promise<void> {
  const embedding = await embedText(params.content);

  db.prepare(
    `UPDATE messages
     SET role = ?, content = ?, embedding_json = ?, created_at = ?
     WHERE id = ?`
  ).run(
    params.role,
    params.content,
    JSON.stringify(embedding),
    params.createdAt,
    params.id
  );

  // Sync FTS5 index
  db.prepare(`DELETE FROM messages_fts WHERE rowid = ?`).run(params.id);
  db.prepare(`INSERT INTO messages_fts(rowid, content) VALUES (?, ?)`).run(
    params.id,
    params.content
  );
}

export function deleteMessageById(id: number): void {
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM messages_fts WHERE rowid = ?`).run(id);
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
  const scoredMap = new Map<
    number,
    { msg: StoredMessage; score: number; reasons: Set<string> }
  >();

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
  const parsedDates = chrono.parse(userQuery, referenceNow, {
    forwardDate: false,
  });
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

export function getAllMessages(limit = 200): StoredMessage[] {
  return db
    .prepare(
      `SELECT id, session_id, role, content, sources_json, created_at
       FROM messages
       ORDER BY created_at ASC, id ASC
       LIMIT ?`
    )
    .all(limit) as StoredMessage[];
}

export function clearMessages() {
  db.exec(`DELETE FROM messages; DELETE FROM messages_fts;`);
}