import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ROLE_GUIDE: Record<string, string> = {
  engineer: "an infrastructure engineer. Be technical: mention p99, headroom and the plan change.",
  finance: "a finance manager. Focus on rupees, monthly and annual impact, and which team owns it. Avoid jargon.",
  leadership: "a CTO in a hurry. Two sentences: the business impact and whether it is safe to approve.",
};

const SYSTEM = `You explain one cloud cost recommendation produced by a deterministic rules engine.
Use ONLY the facts and numbers in the JSON you are given. Never invent numbers, plans or causes.
Write at most 3 short sentences of plain text, no markdown, no lists. Use ₹ for money.`;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "no API key configured" }, { status: 503 });
  }
  let body: { rec?: Record<string, unknown>; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const rec = body.rec;
  if (!rec || typeof rec !== "object") return NextResponse.json({ error: "missing rec" }, { status: 400 });
  const role = body.role && ROLE_GUIDE[body.role] ? body.role : "engineer";

  // only the fields the explanation needs
  const facts = {
    resource: rec.resource_name, env: rec.env, team: rec.team, region: rec.region, action: rec.action,
    title: rec.title, reason: rec.reason, current_plan: rec.current_plan, target_plan: rec.target_plan,
    monthly_saving_inr: rec.saving, risk: rec.risk, confidence_pct: rec.confidence,
    confidence_notes: rec.confidence_notes, peak_check: rec.peak_check, maths: rec.maths,
  };

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Audience: ${ROLE_GUIDE[role]}\n\nRecommendation JSON:\n${JSON.stringify(facts)}` }],
    });
    if (response.stop_reason === "refusal") return NextResponse.json({ error: "declined" }, { status: 502 });
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
    if (!text) return NextResponse.json({ error: "empty" }, { status: 502 });
    return NextResponse.json({ text });
  } catch (e) {
    const status = e instanceof Anthropic.APIError && e.status ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: status >= 500 ? 502 : status });
  }
}
