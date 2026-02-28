"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardEvent } from "@/lib/types";
import { normalizeLanguage } from "./use-language";

const translationCache = new Map<string, string>();

function keyFor(lang: string, text: string): string {
  return `${lang}:${text}`;
}

export function useEventTranslation(
  events: DashboardEvent[],
  language: string,
  extraTexts: string[] = [],
) {
  const targetLang = normalizeLanguage(language);
  const [, setVersion] = useState(0);
  const pendingRef = useRef(false);

  const relevantTexts = useMemo(() => {
    const texts: string[] = [];

    for (const event of events.slice(0, 90)) {
      texts.push(event.title, event.summary, event.placeName);
      texts.push(...event.whatWeKnow.slice(0, 3));
      texts.push(...event.whatWeDontKnow.slice(0, 3));
    }

    texts.push(...extraTexts.slice(0, 200));

    return Array.from(new Set(texts.filter(Boolean))).slice(0, 220);
  }, [events, extraTexts]);

  useEffect(() => {
    if (targetLang === "en") {
      return;
    }

    if (pendingRef.current) {
      return;
    }

    const missing = relevantTexts.filter(
      (text) => !translationCache.has(keyFor(targetLang, text)),
    );

    if (missing.length === 0) {
      return;
    }

    pendingRef.current = true;

    void fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetLang,
        texts: missing,
      }),
    })
      .then((response) => response.json())
      .then((json: { translated?: Record<string, string> }) => {
        for (const [original, translated] of Object.entries(json.translated ?? {})) {
          translationCache.set(keyFor(targetLang, original), translated || original);
        }
        setVersion((value) => value + 1);
      })
      .catch(() => {
        // Ignore translation failures and keep original content.
      })
      .finally(() => {
        pendingRef.current = false;
      });
  }, [relevantTexts, targetLang]);

  const t = useMemo(() => {
    return (text: string): string => {
      if (targetLang === "en") {
        return text;
      }
      return translationCache.get(keyFor(targetLang, text)) ?? text;
    };
  }, [targetLang]);

  return {
    targetLang,
    translateText: t,
  };
}
