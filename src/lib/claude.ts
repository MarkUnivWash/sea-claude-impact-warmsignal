import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
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
