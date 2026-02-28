import { NextRequest, NextResponse } from "next/server";

type TranslateRequest = {
  targetLang?: string;
  texts?: string[];
};

const MAX_TEXTS = 120;
const MAX_TEXT_LENGTH = 1200;
const MAX_TEXTS_WITHOUT_DEEPL = 48;

const LIBRE_ENDPOINTS = [
  "https://translate.argosopentech.com/translate",
  "https://libretranslate.de/translate",
];

function normalizeLang(targetLang?: string): string {
  if (!targetLang) {
    return "en";
  }

  const lang = targetLang.toLowerCase().split("-")[0];
  if (!lang) {
    return "en";
  }

  return lang;
}

async function translateManyWithDeepL(
  texts: string[],
  targetLang: string,
): Promise<Record<string, string> | null> {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey || texts.length === 0) {
    return null;
  }

  const params = new URLSearchParams();
  for (const text of texts) {
    params.append("text", text);
  }
  params.set("target_lang", targetLang.toUpperCase());

  const response = await fetch("https://api-free.deepl.com/v2/translate", {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    return null;
  }

  const json = (await response.json()) as { translations?: Array<{ text?: string }> };
  const translations = json.translations ?? [];
  if (translations.length === 0) {
    return null;
  }

  const out: Record<string, string> = {};
  texts.forEach((original, idx) => {
    out[original] = translations[idx]?.text?.trim() || original;
  });

  return out;
}

async function translateWithLibre(
  text: string,
  targetLang: string,
): Promise<string | null> {
  for (const endpoint of LIBRE_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: text,
          source: "auto",
          target: targetLang,
          format: "text",
        }),
      });

      if (!response.ok) {
        continue;
      }

      const json = (await response.json()) as {
        translatedText?: string;
      };

      if (json.translatedText?.trim()) {
        return json.translatedText.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function translateText(text: string, targetLang: string): Promise<string> {
  const withLibre = await translateWithLibre(text, targetLang);
  if (withLibre) {
    return withLibre;
  }

  return text;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as TranslateRequest;
  const targetLang = normalizeLang(body.targetLang);
  const inputTexts = Array.isArray(body.texts) ? body.texts : [];

  let texts = Array.from(
    new Set(
      inputTexts
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => text.slice(0, MAX_TEXT_LENGTH)),
    ),
  ).slice(0, MAX_TEXTS);

  if (!process.env.DEEPL_API_KEY) {
    texts = texts.slice(0, MAX_TEXTS_WITHOUT_DEEPL);
  }

  if (targetLang === "en" || texts.length === 0) {
    return NextResponse.json({
      targetLang,
      translated: Object.fromEntries(texts.map((text) => [text, text])),
      provider: "none",
    });
  }

  const translated: Record<string, string> = Object.fromEntries(texts.map((text) => [text, text]));

  const deeplResults = await translateManyWithDeepL(texts, targetLang);
  if (deeplResults) {
    for (const [original, translatedText] of Object.entries(deeplResults)) {
      translated[original] = translatedText || original;
    }
    return NextResponse.json({
      targetLang,
      translated,
      provider: "deepl",
    });
  }

  for (const text of texts.slice(0, MAX_TEXTS_WITHOUT_DEEPL)) {
    translated[text] = await translateText(text, targetLang);
  }

  return NextResponse.json({
    targetLang,
    translated,
    provider: "libre",
  });
}
