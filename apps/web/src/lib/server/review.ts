import "server-only";
import { timingSafeEqual } from "node:crypto";

import { allQuestions, OTHER, otherKey, type Answers } from "@/app/dev/review/questions";

/**
 * Design review access. Development needs no key. In production, saving and reading answers require `REVIEW_KEY`;
 * without it the form still renders but cannot save. The key travels as `?key=` in the review link.
 */
export function reviewAccess(key: string | null | undefined): "open" | "granted" | "denied" | "unconfigured" {
  if (process.env.NODE_ENV !== "production") return "open";
  const expected = process.env.REVIEW_KEY;
  if (!expected) return "unconfigured";
  if (!key) return "denied";
  const a = Buffer.from(key), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? "granted" : "denied";
}

export const canUseReview = (key: string | null | undefined) => ["open", "granted"].includes(reviewAccess(key));

const MAX_TEXT = 10_000;
const questions = new Map(allQuestions.map((q) => [q.id, q]));

/** Keeps only known questions and valid option values; throws on anything else. */
export function parseAnswers(input: unknown): Answers {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_answers");
  const out: Answers = {};
  for (const [id, value] of Object.entries(input)) {
    const q = questions.get(id) ?? questions.get(id.replace(/\.other$/, ""));
    if (!q) throw new Error("unknown_question");
    const values = q.kind === "text" ? null : new Set([...q.options.map(([v]) => v), ...(q.other ? [OTHER] : [])]);
    if (id !== q.id) {
      if (id !== otherKey(q.id) || q.kind === "text" || !q.other || typeof value !== "string" || value.length > MAX_TEXT) throw new Error("invalid_answer");
      out[id] = value;
    } else if (q.kind === "multi") {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !values!.has(v))) throw new Error("invalid_answer");
      out[id] = [...new Set(value as string[])];
    } else {
      if (typeof value !== "string" || value.length > MAX_TEXT || (values && value && !values.has(value))) throw new Error("invalid_answer");
      out[id] = value;
    }
  }
  return out;
}
