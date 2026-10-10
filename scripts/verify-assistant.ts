// Checks the owner assistant's guard rails against a scripted stand-in for
// Groq's /chat/completions endpoint (same request/response shape), so the
// pipeline can be verified without burning real API quota:
//
//   DATABASE_URL="file:./dev.db" npx tsx scripts/verify-assistant.ts
//
// This proves the plumbing (tool whitelist, argument validation, retry, the
// number check that discards invented figures, and the offline fallback). It
// does not measure how well Groq picks tools — try that with a real
// GROQ_API_KEY and the questions on the Assistant page.

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";

type GroqBody = {
  model: string;
  messages: { role: string; content: string }[];
  response_format?: { type: string };
  max_completion_tokens?: number;
};
type Handler = (body: GroqBody) => { status?: number; content?: string; raw?: string };

let handler: Handler = () => ({ status: 500, raw: JSON.stringify({ error: { message: "no handler" } }) });
const requests: GroqBody[] = [];

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}") as GroqBody;
    requests.push(body);
    const out = handler(body);
    res.statusCode = out.status ?? 200;
    res.setHeader("Content-Type", "application/json");
    res.end(out.raw ?? JSON.stringify({ choices: [{ message: { role: "assistant", content: out.content ?? "" } }] }));
  });
});

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || detail === undefined ? "" : `\n      ${JSON.stringify(detail).slice(0, 500)}`}`);
  if (!cond) failures++;
}

const isPlanner = (b: GroqBody) => b.response_format?.type === "json_object";
const dataOf = (b: GroqBody) => JSON.parse(b.messages[1].content.split("DATA:\n")[1]);

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  process.env.GROQ_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.GROQ_API_KEY = "test-key";
  process.env.GROQ_MODEL = "test-model";
  process.env.GROQ_TIMEOUT_MS = "5000";
  const { askAssistant, planWithRules, unverifiedNumbers } = await import("../src/lib/assistant/engine");

  // 1. Happy path: model plans profitByOrder, answers with numbers copied from DATA.
  handler = (b) => {
    if (isPlanner(b)) return { content: JSON.stringify({ tool: "profitByOrder", args: {} }) };
    const d = dataOf(b);
    const low = d.realisedOrders[0];
    return {
      content: low
        ? `${low.orderNo} made the least profit this month: ₹${low.profit.toLocaleString("en-IN")} on revenue of ₹${low.revenue.toLocaleString("en-IN")}.`
        : "No order was invoiced this month, so the records don't show a profit yet.",
    };
  };
  requests.length = 0;
  let a = await askAssistant("Which order made the least profit this month?");
  check("llm path: tool chosen by model is run", a.mode === "llm" && a.tool === "profitByOrder" && !a.notice, a);
  check("llm path: model's answer kept when every number is in the data", !a.notice && a.answer.length > 0, a.answer);
  check("requests: planner asks for JSON, configured model", requests[0]?.response_format?.type === "json_object" && requests[0]?.model === "test-model", requests[0]);
  check("requests: answer prompt carries the query result as DATA", requests[1]?.messages[1]?.content.includes("DATA:"), requests[1]);

  // 2. The model invents a number → its wording is discarded.
  handler = (b) =>
    isPlanner(b)
      ? { content: JSON.stringify({ tool: "monthSummary", args: {} }) }
      : { content: "Net profit this month was ₹98,76,543 and margin 77.7%." };
  a = await askAssistant("What was our profit this month?");
  check("guard: invented figures replaced by data-only summary", a.tool === "monthSummary" && !!a.notice && !a.answer.includes("98,76,543"), a);

  // 3. Unknown tool, then bad args, then a valid plan → retried until valid.
  let calls = 0;
  handler = (b) => {
    if (!isPlanner(b)) return { content: "Done." };
    calls++;
    if (calls === 1) return { content: JSON.stringify({ tool: "dropTables", args: {} }) };
    return { content: JSON.stringify({ tool: "machineOutput", args: { days: 7 } }) };
  };
  a = await askAssistant("Machine output this week?");
  check("whitelist: a non-existent tool is refused and the model is re-asked", calls === 2 && a.tool === "machineOutput", { calls, a });

  calls = 0;
  handler = (b) => {
    if (!isPlanner(b)) return { content: "Done." };
    calls++;
    return { content: JSON.stringify({ tool: "monthSummary", args: { month: "last month" } }) };
  };
  a = await askAssistant("Summary for last month");
  check("validation: invalid args twice → falls back to the keyword router", calls === 2 && a.mode === "rules" && a.tool === "monthSummary", { calls, a });

  // 4. Model says nothing fits → capabilities message, no query run.
  handler = () => ({ content: JSON.stringify({ tool: null, args: {} }) });
  a = await askAssistant("Write me a poem about looms");
  check("out of scope: no query run, says what it can answer", a.tool === null && a.data === null && /can answer|can't/i.test(a.answer), a);

  // 5. Model name wrong / not available to this key.
  handler = () => ({ status: 404, raw: JSON.stringify({ error: { message: 'model "test-model" does not exist' } }) });
  a = await askAssistant("How much is outstanding from buyers?");
  check("model missing: falls back, names the config to check", a.mode === "rules" && a.tool === "outstandingPayments" && /GROQ_MODEL/.test(a.notice ?? ""), a);

  // 6. Groq not reachable at all.
  server.close();
  await new Promise((r) => setTimeout(r, 100));
  a = await askAssistant("Which yarn is running low?");
  check("groq down: still answers from the same query", a.mode === "rules" && a.tool === "yarnStock" && /not reachable/.test(a.notice ?? ""), a);

  // 7. Keyword router + number checker units.
  const cases: [string, string | null][] = [
    ["Which order made the least profit this month?", "profitByOrder"],
    ["What did EVR-2610-004 cost?", "orderCost"],
    ["Loom 4 reject rate last 14 days", "machineRejectRate"],
    ["how many holes this week", "defectsByType"],
    ["who was absent most last month", "attendanceSummary"],
    ["unpaid invoices", "outstandingPayments"],
    ["low stock yarn", "yarnStock"],
    ["orders ready for dispatch", "ordersOverview"],
    ["tell me a joke", null],
  ];
  for (const [q, tool] of cases) {
    const p = planWithRules(q);
    check(`router: "${q}" → ${tool}`, p.tool === tool, p);
  }
  check("router: 'last 14 days' parsed", (planWithRules("Loom 4 reject rate last 14 days").args as { days?: number }).days === 14);
  check("numbers: ₹1,23,456.5 matches 123456.5", unverifiedNumbers("Profit ₹1,23,456.5", { profit: 123456.5 }, "").length === 0);
  check("numbers: rounded rupees accepted", unverifiedNumbers("about ₹1,23,457", { profit: 123456.5 }, "").length === 0);
  check("numbers: invented total rejected", unverifiedNumbers("total ₹5,00,000", { a: 200000, b: 250000 }, "").length === 1);

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
