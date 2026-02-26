import * as logger from "../lib/log.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";

export async function generateTitle(description: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn("[title]", "ANTHROPIC_API_KEY not set, using fallback");
    return fallbackTitle(description);
  }

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 30,
        messages: [
          {
            role: "user",
            content: `Generate a short title (max 8 words) for this coding task. Return ONLY the title, nothing else.\n\nTask: ${description}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      logger.warn("[title]", `API error ${res.status}, using fallback`);
      return fallbackTitle(description);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const text = data.content?.[0]?.text?.trim();
    if (!text) return fallbackTitle(description);

    // Strip quotes if the model wrapped the title
    return text.replace(/^["']|["']$/g, "");
  } catch (err) {
    logger.warn("[title]", `generation failed: ${err instanceof Error ? err.message : err}`);
    return fallbackTitle(description);
  }
}

function fallbackTitle(description: string): string {
  return description.length > 60 ? description.slice(0, 57) + "..." : description;
}
