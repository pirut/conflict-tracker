import { SourceType } from "../types";

type SourceLike = {
  sourceType: SourceType;
  sourceName: string;
};

type ConfidenceInput = {
  sourceTypes: SourceType[];
  sources: SourceLike[];
  hasSignals: boolean;
  isGeoPrecise: boolean;
  hasConflict: boolean;
  eventTs: number;
};

export function computeConfidence(input: ConfidenceInput): {
  score: number;
  label: "High" | "Medium" | "Low";
} {
  let score = 0;

  if (input.sourceTypes.includes("news")) {
    score = 60;
  } else if (input.sourceTypes.includes("signals")) {
    score = 40;
  } else {
    score = 20;
  }

  const independentNewsSources = new Set(
    input.sources
      .filter((source) => source.sourceType === "news")
      .map((source) => source.sourceName.toLowerCase()),
  ).size;

  score += Math.min(30, independentNewsSources * 15);

  if (input.hasSignals) {
    score += 10;
  }

  if (input.isGeoPrecise) {
    score += 10;
  }

  const onlySocial =
    input.sourceTypes.length === 1 && input.sourceTypes[0] === "social";

  if (onlySocial && Date.now() - input.eventTs > 60 * 60 * 1000) {
    score -= 15;
  }

  if (input.hasConflict) {
    score -= 10;
  }

  const boundedScore = Math.max(0, Math.min(100, score));

  if (boundedScore >= 75) {
    return { score: boundedScore, label: "High" };
  }

  if (boundedScore >= 45) {
    return { score: boundedScore, label: "Medium" };
  }

  return { score: boundedScore, label: "Low" };
}
