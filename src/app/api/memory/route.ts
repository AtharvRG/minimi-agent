import { NextRequest, NextResponse } from "next/server";
import {
  getAllMessages,
  saveMessage,
  updateMessage,
  deleteMessageById,
  clearMessages,
} from "@/lib/memory";
import { seedChallengeHistory } from "@/lib/seed-history";

export const runtime = "nodejs";

// GET all SQLite memory records
export async function GET() {
  await seedChallengeHistory(false);
  const messages = getAllMessages(200);
  return NextResponse.json({ messages });
}

// POST a new custom memory entry (or trigger actions like 'reseed' / 'clear')
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    action?: "create" | "reseed" | "clear";
    role?: "user" | "assistant";
    content?: string;
    createdAt?: string;
    sessionId?: string;
  };

  if (body.action === "clear") {
    clearMessages();
    return NextResponse.json({ messages: [] });
  }

  if (body.action === "reseed") {
    await seedChallengeHistory(true);
    return NextResponse.json({ messages: getAllMessages(200) });
  }

  if (!body.content?.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  await saveMessage({
    sessionId: body.sessionId || "manual-memory",
    role: body.role || "user",
    content: body.content.trim(),
    createdAt: body.createdAt
      ? new Date(body.createdAt).toISOString()
      : new Date().toISOString(),
  });

  return NextResponse.json({ messages: getAllMessages(200) });
}

// PUT to edit an existing SQLite memory row (re-computes Granite-R2 embedding & FTS5)
export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    id?: number;
    role?: "user" | "assistant";
    content?: string;
    createdAt?: string;
  };

  if (!body.id || !body.content?.trim()) {
    return NextResponse.json(
      { error: "ID and content are required" },
      { status: 400 }
    );
  }

  await updateMessage({
    id: Number(body.id),
    role: body.role || "user",
    content: body.content.trim(),
    createdAt: body.createdAt
      ? new Date(body.createdAt).toISOString()
      : new Date().toISOString(),
  });

  return NextResponse.json({ messages: getAllMessages(200) });
}

// DELETE a single memory row by ID
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  deleteMessageById(Number(id));
  return NextResponse.json({ messages: getAllMessages(200) });
}