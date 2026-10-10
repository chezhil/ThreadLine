"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { postJson } from "@/lib/useApi";
import { PageTitle } from "@/components/accounts/Stat";
import { assistantQuerySchema } from "@/lib/validation/accounts";
import type { AssistantAnswer } from "@/lib/assistant/engine";

export const SUGGESTIONS = [
  "Which order made the least profit this month?",
  "What is the month-end summary for this month?",
  "Which machine has the highest reject rate?",
  "How much money is outstanding from buyers?",
  "Which yarn is running low?",
  "Who was absent the most last month?",
];

type Turn =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; result: AssistantAnswer }
  | { id: number; role: "error"; text: string };

function argsLabel(args: Record<string, unknown>) {
  const parts = Object.entries(args).map(([k, v]) => `${k}=${String(v)}`);
  return parts.length ? parts.join(", ") : "defaults";
}

export function AssistantClient() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  // A question handed over from the dashboard terminal (/assistant?q=…) is
  // asked once on arrival, then dropped from the URL so a reload doesn't
  // repeat it.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (!q) return;
    const id = setTimeout(() => {
      window.history.replaceState(null, "", window.location.pathname);
      void ask(q);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  async function ask(text: string) {
    const parsed = assistantQuerySchema.safeParse({ question: text });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ask a question");
      return;
    }
    setError(null);
    setQuestion("");
    setTurns((t) => [...t, { id: nextId.current++, role: "user", text: parsed.data.question }]);
    setBusy(true);
    try {
      const res = await postJson<AssistantAnswer & { error?: string }>("/api/assistant/query", parsed.data);
      setTurns((t) => [
        ...t,
        res.ok
          ? { id: nextId.current++, role: "assistant", result: res.data }
          : { id: nextId.current++, role: "error", text: res.fieldErrors?.question?.[0] ?? res.data.error ?? "The assistant couldn't answer." },
      ]);
    } catch {
      setTurns((t) => [...t, { id: nextId.current++, role: "error", text: "Couldn't reach the server." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageTitle
        title="Ask the mill"
        subtitle="Runs on Groq. It can only run a fixed set of read-only queries and answers only from what they return; if the records don't have it, it says so."
      />

      <Card className="flex min-h-80 flex-col gap-3">
        {turns.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-gray-500">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-border bg-white px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3" aria-live="polite">
          {turns.map((t) =>
            t.role === "user" ? (
              <div key={t.id} className="ml-auto max-w-[85%] rounded-lg rounded-br-none bg-brand px-3 py-2 text-sm text-brand-foreground">
                {t.text}
              </div>
            ) : t.role === "error" ? (
              <div key={t.id} role="alert" className="max-w-[85%] rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                {t.text}
              </div>
            ) : (
              <AnswerBubble key={t.id} result={t.result} />
            ),
          )}
          {busy && <div className="max-w-[85%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-500">Running the query…</div>}
          <div ref={endRef} />
        </div>
      </Card>

      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) ask(question);
        }}
      >
        <div className="flex gap-2">
          <label htmlFor="assistant-question" className="sr-only">
            Question
          </label>
          <input
            id="assistant-question"
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              setError(null);
            }}
            maxLength={500}
            placeholder="e.g. What did EVR-2610-004 really cost us?"
            className={`flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40 ${error ? "border-red-400" : "border-border"}`}
            aria-invalid={!!error}
          />
          <Button type="submit" disabled={busy}>
            Ask
          </Button>
        </div>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </form>
    </div>
  );
}

function AnswerBubble({ result }: { result: AssistantAnswer }) {
  const [showData, setShowData] = useState(false);
  return (
    <div className="max-w-[92%] rounded-lg rounded-bl-none border border-border bg-gray-50 px-3 py-2">
      <p className="whitespace-pre-wrap text-sm text-foreground">{result.answer}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="rounded-full border border-border bg-white px-2 py-0.5">
          {result.mode === "llm" ? `Local model${result.model ? ` · ${result.model}` : ""}` : "Answered without the model"}
        </span>
        {result.tool && (
          <span className="rounded-full border border-border bg-white px-2 py-0.5 font-mono">
            {result.tool}({argsLabel(result.args)})
          </span>
        )}
        {result.tool && (
          <button type="button" className="font-medium text-brand hover:underline" onClick={() => setShowData((s) => !s)}>
            {showData ? "Hide" : "Show"} source data
          </button>
        )}
      </div>
      {result.notice && <p className="mt-1 text-xs text-amber-700">{result.notice}</p>}
      {showData && (
        <pre className="mt-2 max-h-72 overflow-auto rounded bg-white p-2 text-xs text-gray-700">{JSON.stringify(result.data, null, 2)}</pre>
      )}
    </div>
  );
}
