import { saveMessage, getAllMessages, clearMessages } from "./memory";

function getPreviousDayOfWeek(dayIndex: number, refDate = new Date()): Date {
  // dayIndex: 1 = Monday, 2 = Tuesday
  const d = new Date(refDate);
  const currentDay = d.getDay();
  let diff = currentDay - dayIndex;
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() - diff);
  d.setHours(14, 15, 0, 0);
  return d;
}

export async function seedChallengeHistory(forceReset = false) {
  const existing = getAllMessages(5);
  if (existing.length > 0 && !forceReset) {
    return { seeded: false, count: existing.length };
  }

  if (forceReset) {
    clearMessages();
  }

  const now = new Date();

  // 1. "On Monday we shortlisted 5 CRM tools for a 20-person sales team..."
  const mondayDate = getPreviousDayOfWeek(1, now);
  const mondayReplyDate = new Date(mondayDate.getTime() + 45_000);

  await saveMessage({
    sessionId: "seed-monday-crm",
    role: "user",
    content:
      "Let's shortlist 5 CRM tools for our 20-person B2B sales team. Give me their current per-seat pricing and key strengths.",
    createdAt: mondayDate.toISOString(),
  });

  await saveMessage({
    sessionId: "seed-monday-crm",
    role: "assistant",
    content: `Here is our Monday shortlist of **5 CRM tools** for a 20-person sales team with baseline pricing recorded on ${mondayDate.toISOString().split("T")[0]}:

1. **HubSpot Sales Hub** — Starter at **$20/seat/mo**, Professional at **$100/seat/mo** (includes sequences & forecasting).
2. **Pipedrive** — Essential at **$14/seat/mo**, Advanced at **$34/seat/mo**, Professional at **$49/seat/mo** (annual billing).
3. **Attio** — Plus at **$29/seat/mo**, Pro at **$59/seat/mo** (flexible data model + AI enrichment).
4. **Close CRM** — Startup at **$49/seat/mo**, Professional at **$99/seat/mo** (built-in calling & SMS workflows).
5. **Folk CRM** — Standard at **$20/member/mo**, Premium at **$40/member/mo** (lightweight relationship & outbound workflows).`,
    createdAt: mondayReplyDate.toISOString(),
  });

  // 2. "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"
  const lastTuesdayDate = getPreviousDayOfWeek(2, now);
  const lastTuesdayReplyDate = new Date(lastTuesdayDate.getTime() + 40_000);

  await saveMessage({
    sessionId: "seed-tuesday-postgres",
    role: "user",
    content:
      "Can we compare managed Postgres hosting options (Supabase, Neon, Render, and Railway) and their current pricing tiers?",
    createdAt: lastTuesdayDate.toISOString(),
  });

  await saveMessage({
    sessionId: "seed-tuesday-postgres",
    role: "assistant",
    content: `Here is the managed **Postgres hosting** breakdown recorded on Tuesday (${lastTuesdayDate.toISOString().split("T")[0]}):

- **Supabase**: Free tier (500MB), **Pro at $25/mo** ($10 compute credit included, $0.125/GB storage over 8GB), Team at $599/mo.
- **Neon (Serverless Postgres)**: Free tier (0.5 GB storage, 190 compute hours), **Launch at $19/mo** (usage-based starting tier, 10 GiB storage), **Scale at $69/mo**.
- **Render Postgres**: Free (expires after 30 days), Basic starts at **$6/mo** (256MB RAM) and **$19/mo** (1GB RAM, Pro tier), plus $0.30/GB storage.
- **Railway**: Hobby plan at **$5/mo** (includes $5 resource usage credit) + usage-based RAM ($10/GB/mo) and CPU ($20/vCPU/mo), Pro at **$20/mo**.`,
    createdAt: lastTuesdayReplyDate.toISOString(),
  });

  // 3. "What did I ask you on 3 November? Is your answer still correct today?"
  const nov3Year =
    now.getMonth() === 10 && now.getDate() < 3
      ? now.getFullYear() - 1
      : now.getFullYear();
  const nov3Date = new Date(Date.UTC(nov3Year, 10, 3, 10, 30, 0)); // 10 = November (0-indexed)
  const nov3ReplyDate = new Date(nov3Date.getTime() + 35_000);

  await saveMessage({
    sessionId: "seed-nov3",
    role: "user",
    content:
      "What is the latest stable major version of Next.js and Node.js LTS, and what is OpenAI's flagship reasoning model right now?",
    createdAt: nov3Date.toISOString(),
  });

  await saveMessage({
    sessionId: "seed-nov3",
    role: "assistant",
    content: `As of **3 November (${nov3Date.toISOString().split("T")[0]})**, here are the answers to your three questions:
1. **Next.js Latest Major Version**: Next.js 15 / 16 (with React 19 and Turbopack stable).
2. **Node.js Active LTS**: Node.js 22 LTS (codename 'Jod') is the active LTS release.
3. **OpenAI Models**: OpenAI's reasoning series includes the o1 / o3-mini / GPT-5 series models.`,
    createdAt: nov3ReplyDate.toISOString(),
  });

  return { seeded: true, count: 6 };
}