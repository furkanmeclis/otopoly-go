"use client";

import { Loader2, Mic, Settings2, Square, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useVoice } from "@/features/ai/components/chat/voice/voice-provider";
import {
  useVoiceRecorder,
  type RecorderError,
} from "@/features/ai/hooks/use-voice-recorder";
import { aiVoiceService } from "@/features/ai/services/voice.service";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";
import { appToast } from "@/providers/toast-provider";

/** The UI stops at 60 s; the API rejects clips over 120 s. */
const MAX_SECONDS = 60;
/** Holding the button longer than this makes release stop the recording. */
const HOLD_MS = 350;

const RECORDER_ERROR_KEYS: Record<RecorderError, string> = {
  unsupported: "ai.voice.errors.unsupported",
  permission_denied: "ai.voice.errors.permission_denied",
  no_device: "ai.voice.errors.no_device",
  too_short: "ai.voice.errors.too_short",
  failed: "ai.voice.errors.record_failed",
};

const API_ERROR_KEYS: Record<string, string> = {
  AI_VOICE_DISABLED: "ai.voice.errors.disabled",
  AI_VOICE_UNAVAILABLE: "ai.voice.errors.unavailable",
  AUDIO_TOO_LARGE: "ai.voice.errors.too_long",
  AUDIO_TOO_LONG: "ai.voice.errors.too_long",
  AUDIO_UNSUPPORTED: "ai.voice.errors.unsupported_format",
};

function formatElapsed(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type VoiceInputProps = {
  /** Receives the recognized text (the chat decides: insert or send). */
  onTranscript: (text: string) => void;
  disabled?: boolean;
};

/**
 * Push-to-talk mic for the composer. Click to start/stop, or hold and
 * release. Esc or ✕ cancels. Audio goes to the BFF, never to Speaches.
 */
export function VoiceInput({ onTranscript, disabled }: VoiceInputProps) {
  const { t } = useLocale();
  const voice = useVoice();
  const [transcribing, setTranscribing] = useState(false);
  const pressRef = useRef<{ at: number; startedHere: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onComplete = useCallback(
    (audio: Blob) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setTranscribing(true);
      aiVoiceService
        .transcribe(audio, controller.signal)
        .then((res) => {
          const text = res.text.trim();
          if (text) onTranscript(text);
          else appToast.info(t("ai.voice.errors.no_speech"));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const key =
            (isApiError(error) && API_ERROR_KEYS[error.code]) ||
            "ai.voice.errors.transcribe_failed";
          appToast.error(t(key));
        })
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
          setTranscribing(false);
        });
    },
    [onTranscript, t],
  );

  const onError = useCallback(
    (error: RecorderError) => {
      const toast = error === "too_short" ? appToast.info : appToast.error;
      toast(t(RECORDER_ERROR_KEYS[error]));
    },
    [t],
  );

  const recorder = useVoiceRecorder({
    maxSeconds: MAX_SECONDS,
    onComplete,
    onError,
  });
  const recording = recorder.state === "recording";
  const busy = recorder.state === "requesting" || transcribing;

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        recorder.cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, recorder]);

  const begin = () => {
    voice?.stopSpeaking(); // don't record the assistant's own voice
    void recorder.start();
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || disabled || busy) return;
    if (recording) {
      pressRef.current = { at: Date.now(), startedHere: false };
      return;
    }
    pressRef.current = { at: Date.now(), startedHere: true };
    begin();
  };

  const onPointerUp = () => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press) return;
    const held = Date.now() - press.at >= HOLD_MS;
    // Tap while recording stops; releasing a long press (push-to-talk) stops.
    if (!press.startedHere || held) recorder.stop();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (disabled || busy) return;
    if (recording) recorder.stop();
    else begin();
  };

  if (!recorder.supported) {
    return (
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={() => appToast.error(t("ai.voice.errors.unsupported"))}
        aria-label={t("ai.voice.errors.unsupported")}
        title={t("ai.voice.errors.unsupported")}
        className="text-muted-foreground opacity-60"
      >
        <Mic className="size-4" />
      </Button>
    );
  }

  const label = recording
    ? t("ai.voice.stop_recording")
    : transcribing
      ? t("ai.voice.transcribing")
      : t("ai.voice.record");

  return (
    <div className="flex items-center gap-1">
      {recording ? (
        <>
          <span
            className="text-destructive flex items-center gap-1.5 px-1 text-xs font-medium tabular-nums"
            role="status"
            aria-live="polite"
          >
            <span className="relative flex size-2">
              <span className="bg-destructive absolute inline-flex size-full animate-ping rounded-full opacity-75" />
              <span className="bg-destructive relative inline-flex size-2 rounded-full" />
            </span>
            {formatElapsed(recorder.elapsed)}
            <span className="text-muted-foreground font-normal">
              / {formatElapsed(MAX_SECONDS)}
            </span>
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={recorder.cancel}
            aria-label={t("ai.voice.cancel")}
            title={`${t("ai.voice.cancel")} (Esc)`}
          >
            <X className="size-4" />
          </Button>
        </>
      ) : transcribing ? (
        <span className="text-muted-foreground px-1 text-xs" role="status">
          {t("ai.voice.transcribing")}
        </span>
      ) : null}

      {!recording && !transcribing && voice ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="text-muted-foreground"
              aria-label={t("ai.voice.settings")}
              title={t("ai.voice.settings")}
            >
              <Settings2 className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-64">
            <DropdownMenuLabel className="text-xs">
              {t("ai.voice.settings")}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={voice.prefs.autoSend}
              onCheckedChange={(v) => voice.setPref("autoSend", v === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {t("ai.voice.auto_send")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={voice.prefs.autoRead}
              onCheckedChange={(v) => voice.setPref("autoRead", v === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {t("ai.voice.auto_read")}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Button
        type="button"
        size="icon-sm"
        variant={recording ? "destructive" : "ghost"}
        disabled={disabled || busy}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (pressRef.current?.startedHere) onPointerUp();
        }}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        aria-label={label}
        aria-pressed={recording}
        title={`${label} — ${t("ai.voice.hint")}`}
        className={cn("touch-none select-none", recording && "shadow-sm")}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : recording ? (
          <Square className="size-3.5 fill-current" />
        ) : (
          <Mic className="size-4" />
        )}
      </Button>
    </div>
  );
}
