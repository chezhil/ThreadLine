// Minimal client for a local Ollama server. Server-side only: the browser never
// talks to the model. Configure with OLLAMA_URL / OLLAMA_MODEL in .env.

export const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1:8b";
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 90_000);

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OllamaUnavailableError extends Error {}

export async function ollamaChat(messages: ChatMessage[], opts: { json?: boolean } = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        ...(opts.json ? { format: "json" } : {}),
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    const reason = controller.signal.aborted ? `timed out after ${TIMEOUT_MS / 1000}s` : "is not reachable";
    throw new OllamaUnavailableError(`The local model at ${OLLAMA_URL} ${reason}${e instanceof Error && !controller.signal.aborted ? ` (${e.message})` : ""}.`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404 && /model/i.test(body)) {
      throw new OllamaUnavailableError(`Model "${OLLAMA_MODEL}" is not installed in Ollama. Run: ollama pull ${OLLAMA_MODEL}`);
    }
    throw new OllamaUnavailableError(`Ollama returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { message?: { content?: string } };
  const content = json.message?.content;
  if (typeof content !== "string") throw new OllamaUnavailableError("Ollama returned no message content.");
  return content;
}
