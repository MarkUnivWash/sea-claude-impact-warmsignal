import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { partialParse } from "@anthropic-ai/sdk/_vendor/partial-json-parser/parser";
import type { z } from "zod";

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  return (client ??= new Anthropic());
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** One Claude call that returns JSON validated against a Zod schema. */
export async function structuredCall<S extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: S;
  effort?: Effort;
}): Promise<z.infer<S>> {
  const res = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // On a safety-classifier refusal, let the API retry on its recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
  });

  if (res.stop_reason === "refusal") {
    throw new Error(`Claude declined the request (${res.stop_details?.category ?? "unknown"})`);
  }
  if (res.stop_reason === "max_tokens") {
    throw new Error("Claude response was truncated (max_tokens)");
  }
  if (res.parsed_output == null) {
    throw new Error("Claude returned output that did not match the schema");
  }
  return res.parsed_output as z.infer<S>;
}

/**
 * Same as structuredCall, but streams: onPartial receives the JSON parsed so far (possibly
 * incomplete) after every text delta, so a UI can show results while Claude is still writing.
 */
export async function structuredStream<S extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: S;
  effort?: Effort;
  onPartial: (partial: unknown) => void;
  signal?: AbortSignal;
}): Promise<z.infer<S>> {
  const stream = anthropic().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
    },
    { signal: opts.signal },
  );
  stream.on("text", (_delta, snapshot) => {
    try {
      opts.onPartial(partialParse(snapshot));
    } catch {
      // Snapshot not parseable yet (e.g. mid-token); the next delta will be.
    }
  });
  const res = await stream.finalMessage();

  if (res.stop_reason === "refusal") {
    throw new Error(`Claude declined the request (${res.stop_details?.category ?? "unknown"})`);
  }
  if (res.stop_reason === "max_tokens") {
    throw new Error("Claude response was truncated (max_tokens)");
  }
  // Partial snapshots are display-only; the final output is what gets validated and returned.
  const parsed = opts.schema.safeParse(res.parsed_output);
  if (!parsed.success) {
    throw new Error("Claude returned output that did not match the schema");
  }
  return parsed.data as z.infer<S>;
}

export async function textCall(opts: { system: string; user: string; effort?: Effort }): Promise<string> {
  const res = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { effort: opts.effort ?? "low" },
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined the request");
  return res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
}
