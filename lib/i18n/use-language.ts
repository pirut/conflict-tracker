"use client";

import { useState } from "react";

export function normalizeLanguage(input?: string): string {
  if (!input) {
    return "en";
  }
  const lang = input.toLowerCase().split("-")[0];
  return lang || "en";
}

export function useUserLanguage(): string {
  const [lang] = useState(() => {
    if (typeof navigator === "undefined") {
      return "en";
    }
    return normalizeLanguage(navigator.language);
  });

  return lang;
}
