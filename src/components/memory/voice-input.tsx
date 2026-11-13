"use client";

import * as React from "react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

/**
 * Dictation button for note fields (Web Speech API). Hidden on browsers that
 * don't support it, so typing always works.
 */
export function VoiceInput({ onText, lang = "en-IN", className }: { onText: (text: string) => void; lang?: string; className?: string }) {
  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const rec = React.useRef<SpeechRecognitionLike | null>(null);

  React.useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => rec.current?.stop();
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition!;
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results)
        .filter((res) => res.isFinal)
        .map((res) => res[0].transcript)
        .join(" ")
        .trim();
      if (text) onText(text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? "Stop dictation" : "Dictate note"}
      className={cn(
        "focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-colors",
        listening ? "bg-danger/15 text-danger shadow-[inset_0_0_0_1px_rgb(255_92_122/0.35)]" : "text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-fg",
        className,
      )}
    >
      {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
      {listening ? "Listening… tap to stop" : "Speak note"}
    </button>
  );
}
