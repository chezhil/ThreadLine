// Minimal client for the Groq API (OpenAI-compatible chat completions).
// Server-side only: the browser never talks to the model or sees the API
// key. Configure with GROQ_API_KEY / GROQ_MODEL in .env. GROQ_API_BASE_URL
// exists only so tests can point this at a local stand-in server instead of
// Groq's real endpoint.

export const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
const GROQ_BASE_URL = (process.env.GROQ_API_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS ?? 20_000);

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class GroqUnavailableError extends Error {}

interface GroqResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; code?: string };
}

/** `maxTokens` caps the reply length; leave it unset for calls whose output
 * can legitimately be long. */
export async function groqChat(messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number } = {}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new GroqUnavailableError("GROQ_API_KEY is not set, so the assistant has no model to call.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0,
        // This app's calls are a short JSON tool-pick or a short grounded
        // summary, not multi-step reasoning — low effort keeps latency and
        // reasoning-token cost down with no loss of quality for these tasks.
        reasoning_effort: "low",
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        ...(opts.maxTokens ? { max_completion_tokens: opts.maxTokens } : {}),
      }),
      signal: controller.signal,
    });
  } catch (e) {
    const reason = controller.signal.aborted ? `timed out after ${TIMEOUT_MS / 1000}s` : "is not reachable";
    throw new GroqUnavailableError(`Groq ${reason}${e instanceof Error && !controller.signal.aborted ? ` (${e.message})` : ""}.`);
  } finally {
    clearTimeout(timer);
  }

  const json = (await res.json().catch(() => null)) as GroqResponse | null;
  if (!res.ok || !json) {
    const message = json?.error?.message ?? (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 404) {
      throw new GroqUnavailableError(`Model "${GROQ_MODEL}" was not found. Check GROQ_MODEL against https://console.groq.com/docs/models.`);
    }
    if (res.status === 401) {
      throw new GroqUnavailableError(`Groq rejected the API key: ${message}`);
    }
    if (res.status === 429) {
      throw new GroqUnavailableError("Groq rate limit or quota exceeded.");
    }
    throw new GroqUnavailableError(`Groq returned ${res.status}: ${message}`);
  }

  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) throw new GroqUnavailableError("Groq returned no message content.");
  return content;
}
