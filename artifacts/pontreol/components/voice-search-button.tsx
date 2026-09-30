"use client";

import { Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

// Browser speech recognition (Chrome/Android); the button hides where unsupported.
type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
};

const SPEECH_LANG: Record<string, string> = {
  hi: "hi-IN", bn: "bn-IN", te: "te-IN", mr: "mr-IN", ta: "ta-IN", ur: "ur-IN", gu: "gu-IN",
  kn: "kn-IN", or: "or-IN", ml: "ml-IN", pa: "pa-IN", as: "as-IN", ne: "ne-NP", sd: "sd-IN",
  mai: "hi-IN", doi: "hi-IN", kok: "mr-IN", brx: "hi-IN", sa: "hi-IN", ks: "ur-IN", mni: "bn-IN", sat: "hi-IN",
};

export function VoiceSearchButton({ onText }: { onText: (text: string) => void }) {
  const lang = useLang();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  if (!supported) return null;

  const start = () => {
    const w = window as unknown as Record<string, new () => Recognition>;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = SPEECH_LANG[lang] ?? "en-IN";
    rec.interimResults = false;
    rec.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript;
      if (text) onText(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  };

  return (
    <button type="button" onClick={start} aria-label="Search by voice" title="Search by voice"
      className={`h-10 w-10 shrink-0 rounded-lg border border-border flex items-center justify-center ${listening ? "bg-red-500 text-white animate-pulse" : "bg-input text-muted-foreground hover:text-foreground"}`}>
      <Mic className="h-4 w-4" />
    </button>
  );
}
