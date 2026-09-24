"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { aiVoiceService } from "@/features/ai/services/voice.service";
import { isApiError } from "@/lib/api";
import { useLocale } from "@/providers/locale-provider";
import { appToast } from "@/providers/toast-provider";

export type VoicePrefs = {
  /** Send the transcript immediately instead of putting it in the composer. */
  autoSend: boolean;
  /** Read each finished assistant reply aloud. */
  autoRead: boolean;
};

const PREFS_KEY = "ai.voice.prefs";
const DEFAULT_PREFS: VoicePrefs = { autoSend: false, autoRead: false };

function readPrefs(): VoicePrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<VoicePrefs>;
    return {
      autoSend: parsed.autoSend === true,
      autoRead: parsed.autoRead === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: VoicePrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode / blocked storage: the preference just isn't remembered.
  }
}

type VoiceContextValue = {
  prefs: VoicePrefs;
  setPref: (key: keyof VoicePrefs, value: boolean) => void;
  /** Id of the message being read aloud (or fetched), if any. */
  activeId: string | null;
  loading: boolean;
  speak: (id: string, text: string) => void;
  stopSpeaking: () => void;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

/** Voice features for the chat; null when voice is off for the tenant. */
export function useVoice() {
  return useContext(VoiceContext);
}

/**
 * Per-chat voice state: viewer preferences (localStorage) and a single
 * read-aloud player so only one reply plays at a time.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const [prefs, setPrefs] = useState<VoicePrefs>(DEFAULT_PREFS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Read after mount so server and client render the same markup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(readPrefs());
  }, []);

  const setPref = useCallback((key: keyof VoicePrefs, value: boolean) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      writePrefs(next);
      return next;
    });
  }, []);

  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    cleanup();
    setActiveId(null);
    setLoading(false);
  }, [cleanup]);

  const speak = useCallback(
    (id: string, text: string) => {
      cleanup();
      if (!text.trim()) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setActiveId(id);
      setLoading(true);
      aiVoiceService
        .speech(text, controller.signal)
        .then(async (blob) => {
          if (controller.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          const audio = audioRef.current ?? new Audio();
          audioRef.current = audio;
          audio.onended = () => stopSpeaking();
          audio.onerror = () => stopSpeaking();
          audio.src = url;
          setLoading(false);
          try {
            await audio.play();
          } catch {
            // Autoplay blocked (no recent user gesture): the button still works.
            stopSpeaking();
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          stopSpeaking();
          const code = isApiError(error) ? error.code : "";
          appToast.error(
            code === "AI_VOICE_DISABLED"
              ? t("ai.voice.errors.disabled")
              : t("ai.voice.errors.speech_failed"),
          );
        });
    },
    [cleanup, stopSpeaking, t],
  );

  useEffect(() => cleanup, [cleanup]);

  const value = useMemo(
    () => ({ prefs, setPref, activeId, loading, speak, stopSpeaking }),
    [prefs, setPref, activeId, loading, speak, stopSpeaking],
  );
  return (
    <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
  );
}
