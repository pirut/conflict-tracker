const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "in",
  "on",
  "at",
  "of",
  "for",
  "to",
  "and",
  "from",
  "with",
  "is",
  "are",
  "was",
  "were",
  "by",
]);

const CONFLICT_TERMS = ["denied", "false", "disputed", "hoax", "incorrect"];

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));

  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function looksContradictory(text: string): boolean {
  const normalized = normalizeText(text);
  return CONFLICT_TERMS.some((term) => normalized.includes(term));
}
