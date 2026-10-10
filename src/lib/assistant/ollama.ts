// Minimal client for a local Ollama server. Server-side only: the browser never
// talks to the model. Configure with OLLAMA_URL / OLLAMA_MODEL in .env.

export const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1:8b";
// Separate from OLLAMA_MODEL: the text assistant model (e.g. llama3.1) can't
// read images. Reading a handwritten register needs a multimodal model.
export const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL ?? "llava";
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 90_000);
// Vision inference is much slower than text, even warm — measured ~160s for
// one register photo on Apple M5 with llava. Separate from OLLAMA_TIMEOUT_MS
// so raising this doesn't also make a hung/unreachable text assistant call
// wait longer before reporting the problem.
const VISION_TIMEOUT_MS = Number(process.env.OLLAMA_VISION_TIMEOUT_MS ?? 240_000);

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Base64-encoded image data (no data: prefix), vision models only. */
  images?: string[];
}

export class OllamaUnavailableError extends Error {}

async function ollamaRequest(
  model: string,
  messages: ChatMessage[],
  opts: { json?: boolean; timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(opts.json ? { format: "json" } : {}),
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    const reason = controller.signal.aborted ? `timed out after ${timeoutMs / 1000}s` : "is not reachable";
    throw new OllamaUnavailableError(`The local model at ${OLLAMA_URL} ${reason}${e instanceof Error && !controller.signal.aborted ? ` (${e.message})` : ""}.`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404 && /model/i.test(body)) {
      throw new OllamaUnavailableError(`Model "${model}" is not installed in Ollama. Run: ollama pull ${model}`);
    }
    throw new OllamaUnavailableError(`Ollama returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { message?: { content?: string } };
  const content = json.message?.content;
  if (typeof content !== "string") throw new OllamaUnavailableError("Ollama returned no message content.");
  return content;
}

export async function ollamaChat(messages: ChatMessage[], opts: { json?: boolean } = {}): Promise<string> {
  return ollamaRequest(OLLAMA_MODEL, messages, opts);
}

/** Like ollamaChat, but against the vision-capable model for image input. */
export async function ollamaVision(messages: ChatMessage[], opts: { json?: boolean } = {}): Promise<string> {
  return ollamaRequest(OLLAMA_VISION_MODEL, messages, { ...opts, timeoutMs: VISION_TIMEOUT_MS });
}
