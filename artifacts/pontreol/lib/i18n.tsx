"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { LANGUAGES, STRINGS, type Key, type LangCode } from "./i18n-strings";
import { UI, UI_EN, type UiKey } from "./i18n-ui";

const STORAGE_KEY = "pontreol-lang";
const LangContext = createContext<{ lang: LangCode; setLang: (lang: LangCode) => void }>({
  lang: "en",
  setLang: () => {},
});

function isLang(value: string | null): value is LangCode {
  return LANGUAGES.some((l) => l.code === value);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>("en");

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch {}
    if (isLang(saved)) setLangState(saved);
  }, []);

  useEffect(() => {
    const info = LANGUAGES.find((l) => l.code === lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = info && "rtl" in info && info.rtl ? "rtl" : "ltr";
  }, [lang]);

  const setLang = (next: LangCode) => {
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  };

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useT() {
  const { lang } = useContext(LangContext);
  return (key: Key | UiKey) =>
    key in UI_EN
      ? UI[lang]?.[key as UiKey] ?? UI_EN[key as UiKey]
      : STRINGS[lang]?.[key as Key] ?? STRINGS.en[key as Key] ?? key;
}

export function LanguagePicker({ className = "" }: { className?: string }) {
  const { lang, setLang } = useContext(LangContext);
  const t = useT();
  return (
    <select
      aria-label={t("language")}
      value={lang}
      onChange={(e) => isLang(e.target.value) && setLang(e.target.value)}
      className={`h-9 rounded-md border border-border bg-input px-2 text-sm ${className}`}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>{l.name}</option>
      ))}
    </select>
  );
}

export function useLang() {
  return useContext(LangContext).lang;
}
