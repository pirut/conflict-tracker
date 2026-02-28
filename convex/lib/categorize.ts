import { CATEGORY_KEYWORDS } from "../constants";
import { EventCategory } from "../types";
import { normalizeText, tokenize } from "./text";

export function detectCategory(text: string): EventCategory {
  const normalized = normalizeText(text);

  for (const [category, terms] of Object.entries(CATEGORY_KEYWORDS)) {
    if (terms.some((term) => normalized.includes(term))) {
      return category as EventCategory;
    }
  }

  return "other";
}

export function extractKeywords(text: string): string[] {
  return tokenize(text).slice(0, 24);
}
