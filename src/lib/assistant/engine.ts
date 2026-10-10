import { currentMonthKey, monthLabel, shiftMonth } from "../accounts/period";
import { findTool, toolCatalog, TOOLS } from "./tools";
import { ollamaChat, OllamaUnavailableError, OLLAMA_MODEL, type ChatMessage } from "./ollama";
import { summarize } from "./summarize";

// Owner assistant pipeline:
//   1. the local model picks ONE whitelisted tool + arguments (JSON only)
//   2. the server validates both and runs the read-only query
//   3. the model phrases an answer from that query result only
//   4. every number in the answer is checked against the query result; if any
//      number isn't there, the model's wording is discarded and a deterministic
//      summary of the same result is returned instead
// If Ollama is down, a keyword router picks the tool and the deterministic
// summary answers, so the owner still gets a data-backed answer offline.

export interface AssistantAnswer {
  answer: string;
  tool: string | null;
  args: Record<string, unknown>;
  data: unknown;
  /** llm = model chose the query and wrote the answer; rules = keyword router + template */
  mode: "llm" | "rules";
  /** true when every number in `answer` was found in `data` */
  verified: boolean;
  notice?: string;
  model?: string;
}

const CAPABILITIES =
  "I can answer from the mill's own records: profit per order and per month, an order's cost breakdown, month-end summary, machine output, machine reject rates, defect types, yarn stock, outstanding payments, attendance and wages, order status, and unread alerts.";

function dateContext() {
  const month = currentMonthKey();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return { today, month, lastMonth: shiftMonth(month, -1) };
}

// ---------------------------------------------------------------- planning --

interface Plan {
  tool: string | null;
  args: Record<string, unknown>;
}

async function planWithModel(question: string): Promise<Plan | null> {
  const { today, month, lastMonth } = dateContext();
  const system = `You route a textile mill owner's question to exactly one read-only data tool.
Today is ${today} (IST). "This month" = ${month} (${monthLabel(month)}). "Last month" = ${lastMonth}.

Tools:
${toolCatalog()}

Reply with JSON only, no prose:
{"tool": "<tool name>", "args": { ... }}
Use only argument names listed for that tool; omit optional arguments you don't need.
If no tool can answer the question, reply {"tool": null, "args": {}}.`;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: question },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    // A plan is a few dozen tokens. The cap stops a model that loops in JSON
    // mode (seen with very small models) from holding the request until timeout.
    const raw = await ollamaChat(messages, { json: true, maxTokens: 256 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      messages.push({ role: "assistant", content: raw }, { role: "user", content: "That was not valid JSON. Reply with the JSON object only." });
      continue;
    }
    const p = parsed as { tool?: unknown; args?: unknown };
    if (p.tool === null) return { tool: null, args: {} };
    const t = typeof p.tool === "string" ? findTool(p.tool) : undefined;
    if (!t) {
      messages.push(
        { role: "assistant", content: raw },
        { role: "user", content: `"${String(p.tool)}" is not a tool. Choose one of: ${TOOLS.map((x) => x.name).join(", ")}, or null.` },
      );
      continue;
    }
    const args = t.args.safeParse(p.args ?? {});
    if (!args.success) {
      messages.push(
        { role: "assistant", content: raw },
        { role: "user", content: `Invalid args for ${t.name}: ${args.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Fix them.` },
      );
      continue;
    }
    return { tool: t.name, args: args.data as Record<string, unknown> };
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Keyword router used when the model is unavailable or can't produce a valid plan. */
export function planWithRules(question: string): Plan {
  const q = question.toLowerCase();
  const { month, lastMonth } = dateContext();

  let m: string | undefined;
  if (/last month|previous month/.test(q)) m = lastMonth;
  else {
    const named = q.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{4})?\b/);
    if (named) {
      const year = named[2] ?? month.slice(0, 4);
      m = `${year}-${String(MONTHS.indexOf(named[1]) + 1).padStart(2, "0")}`;
    }
    const iso = q.match(/\b(\d{4})-(0[1-9]|1[0-2])\b/);
    if (iso) m = `${iso[1]}-${iso[2]}`;
  }
  const daysMatch = q.match(/(?:last|past)\s+(\d{1,3})\s+days?/);
  const days = daysMatch
    ? Math.min(90, Math.max(1, Number(daysMatch[1])))
    : /today/.test(q)
      ? 1
      : /this week|last week|7 days/.test(q)
        ? 7
        : undefined;
  const monthArg = m ? { month: m } : {};

  const orderNo = question.match(/\b[A-Z]{3}-\d{4}-\d{3}\b/i)?.[0];
  if (orderNo) return { tool: "orderCost", args: { orderNo: orderNo.toUpperCase() } };

  const machine = q.match(/\b(loom|spinning|dyeing|ringframe)\s*\d+\b/)?.[0];
  if (/reject|rejection|defect rate|quality|rework/.test(q) && (machine || /machine|loom/.test(q)))
    return { tool: "machineRejectRate", args: { ...(machine ? { machineName: machine } : {}), ...(days ? { days } : {}) } };
  if (/defect|hole|colour mismatch|color mismatch|uneven weave/.test(q))
    return { tool: "defectsByType", args: days ? { days } : {} };
  if (/profit|loss|margin|profitable|earn/.test(q) && /order/.test(q)) return { tool: "profitByOrder", args: monthArg };
  if (/summary|p&l|p & l|net profit|profit|revenue|expense|spend|gst|cash|month[- ]end/.test(q))
    return { tool: "monthSummary", args: monthArg };
  if (/output|produc|metres|meters|utili[sz]ation/.test(q)) return { tool: "machineOutput", args: days ? { days } : {} };
  if (/yarn|stock|inventory|reorder/.test(q)) return { tool: "yarnStock", args: /low|short|reorder/.test(q) ? { onlyLow: true } : {} };
  if (/outstanding|receivable|unpaid|owe|due|pending payment|collect/.test(q)) return { tool: "outstandingPayments", args: {} };
  if (/attendance|absent|wage|salary|worker|labour|labor/.test(q)) return { tool: "attendanceSummary", args: monthArg };
  if (/alert|notification|warning/.test(q)) return { tool: "recentAlerts", args: {} };
  const status = q.match(/\b(new|confirmed|in production|qc|ready|dispatched|closed)\b/)?.[1];
  if (/order|deadline|dispatch/.test(q))
    return { tool: "ordersOverview", args: status ? { status: status.toUpperCase().replace(" ", "_") } : {} };
  return { tool: null, args: {} };
}

// ------------------------------------------------------------- verification --

const NUM_RE = /-?\d[\d,]*(?:\.\d+)?/g;

function numbersIn(text: string): number[] {
  return (text.match(NUM_RE) ?? [])
    .map((s) => Number(s.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

function collectNumbers(value: unknown, out: Set<number>) {
  if (typeof value === "number") {
    for (const n of [value, Math.abs(value)]) {
      out.add(n);
      out.add(Math.round(n));
      out.add(Math.round(n * 10) / 10);
      out.add(Math.round(n * 100) / 100);
    }
  } else if (typeof value === "string") {
    for (const n of numbersIn(value)) collectNumbers(n, out);
  } else if (Array.isArray(value)) {
    out.add(value.length);
    for (const v of value) collectNumbers(v, out);
  } else if (value && typeof value === "object") {
    out.add(Object.keys(value).length);
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
}

/** Numbers in `answer` that don't appear in the data (or the question). */
export function unverifiedNumbers(answer: string, data: unknown, question: string): number[] {
  const allowed = new Set<number>();
  collectNumbers(data, allowed);
  for (const n of numbersIn(question)) allowed.add(n);
  return numbersIn(answer).filter((n) => {
    if (allowed.has(n) || allowed.has(Math.abs(n))) return false;
    // "₹1,234.5" vs 1234.50, and rounding to whole rupees
    for (const a of allowed) if (Math.abs(a - n) < 0.01 || Math.round(a) === n) return false;
    return true;
  });
}

// ---------------------------------------------------------------- pipeline --

async function runTool(plan: Plan) {
  const t = findTool(plan.tool!)!;
  const args = t.args.parse(plan.args);
  return { args: args as Record<string, unknown>, data: await t.run(args) };
}

export async function askAssistant(question: string): Promise<AssistantAnswer> {
  let plan: Plan | null = null;
  let modelDown: string | null = null;
  try {
    plan = await planWithModel(question);
  } catch (e) {
    if (!(e instanceof OllamaUnavailableError)) throw e;
    modelDown = e.message;
  }

  if (modelDown || !plan) {
    const rules = planWithRules(question);
    const notice = modelDown
      ? `${modelDown} Answered from the same whitelisted queries without the model.`
      : "The local model couldn't map this question to a query, so a keyword match was used.";
    if (!rules.tool) {
      return { answer: `I couldn't match that to any of my queries. ${CAPABILITIES}`, tool: null, args: {}, data: null, mode: "rules", verified: true, notice };
    }
    const { args, data } = await runTool(rules);
    return { answer: summarize(rules.tool, data), tool: rules.tool, args, data, mode: "rules", verified: true, notice };
  }

  if (!plan.tool) {
    return {
      answer: `That isn't something I can answer from the mill's records. ${CAPABILITIES}`,
      tool: null,
      args: {},
      data: null,
      mode: "llm",
      verified: true,
      model: OLLAMA_MODEL,
    };
  }

  const { args, data } = await runTool(plan);
  const fallback = summarize(plan.tool, data);

  let answer: string;
  try {
    answer = (
      await ollamaChat([
        {
          role: "system",
          content: `You are the owner's assistant at Everest Textile Mills. Answer the question using ONLY the JSON in DATA, which is the result of the query "${plan.tool}".
Rules:
- Use only numbers that appear in DATA. Do not add, subtract, average or convert numbers yourself. Currency is INR (₹); you may add ₹ and thousands separators.
- If DATA is empty or does not contain what the question needs, say plainly that the records don't have it. Never guess.
- If DATA lists dataGaps that affect the answer, mention them briefly.
- At most 4 short sentences. No markdown tables.`,
        },
        { role: "user", content: `Question: ${question}\n\nDATA:\n${JSON.stringify(data)}` },
      ], { maxTokens: 400 }) // at most 4 short sentences
    ).trim();
  } catch (e) {
    if (!(e instanceof OllamaUnavailableError)) throw e;
    return { answer: fallback, tool: plan.tool, args, data, mode: "rules", verified: true, notice: `${e.message} The query was chosen by the model; the answer was written from its result without the model.`, model: OLLAMA_MODEL };
  }

  const bad = unverifiedNumbers(answer, data, question);
  if (!answer || bad.length) {
    return {
      answer: fallback,
      tool: plan.tool,
      args,
      data,
      mode: "llm",
      verified: true,
      notice: bad.length
        ? `The model's wording contained number(s) not in the query result (${bad.slice(0, 5).join(", ")}), so it was replaced with a summary generated directly from the data.`
        : "The model returned an empty answer, so a summary generated from the data is shown.",
      model: OLLAMA_MODEL,
    };
  }
  return { answer, tool: plan.tool, args, data, mode: "llm", verified: true, model: OLLAMA_MODEL };
}
