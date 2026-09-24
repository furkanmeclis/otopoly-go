"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export type RecorderState = "idle" | "requesting" | "recording";

export type RecorderError =
  "unsupported" | "permission_denied" | "no_device" | "too_short" | "failed";

type Options = {
  /** Recording stops (and completes) automatically after this many seconds. */
  maxSeconds: number;
  onComplete: (audio: Blob, seconds: number) => void;
  onError: (error: RecorderError) => void;
};

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

const MIN_SECONDS = 0.4;

function isSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

const noopSubscribe = () => () => undefined;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function mapError(error: unknown): RecorderError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "permission_denied";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "no_device";
  }
  return "failed";
}

/**
 * Push-to-talk recorder around MediaRecorder (webm/opus where available,
 * mp4 on Safari). The microphone is released as soon as recording ends.
 */
export function useVoiceRecorder({ maxSeconds, onComplete, onError }: Options) {
  const supported = useSyncExternalStore(
    noopSubscribe,
    isSupported,
    () => false,
  );
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const callbacks = useRef({ onComplete, onError });
  useEffect(() => {
    callbacks.current = { onComplete, onError };
  });

  const releaseStream = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      releaseStream();
      setState("idle");
    }
  }, [releaseStream]);

  const start = useCallback(async () => {
    if (!isSupported()) {
      callbacks.current.onError("unsupported");
      return;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") return;
    setState("requesting");
    cancelledRef.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      setState("idle");
      callbacks.current.onError(mapError(error));
      return;
    }
    if (cancelledRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      setState("idle");
      return;
    }
    streamRef.current = stream;
    let recorder: MediaRecorder;
    try {
      const mimeType = pickMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      releaseStream();
      setState("idle");
      callbacks.current.onError("failed");
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const seconds = (performance.now() - startedAtRef.current) / 1000;
      releaseStream();
      recorderRef.current = null;
      setState("idle");
      setElapsed(0);
      if (cancelledRef.current) return;
      const type =
        recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (seconds < MIN_SECONDS || blob.size === 0) {
        callbacks.current.onError("too_short");
        return;
      }
      callbacks.current.onComplete(blob, seconds);
    };
    recorder.onerror = () => {
      cancelledRef.current = true;
      if (recorder.state !== "inactive") recorder.stop();
      callbacks.current.onError("failed");
    };
    recorderRef.current = recorder;
    startedAtRef.current = performance.now();
    setElapsed(0);
    recorder.start(250);
    setState("recording");
    timerRef.current = window.setInterval(() => {
      const secs = (performance.now() - startedAtRef.current) / 1000;
      setElapsed(secs);
      if (secs >= maxSeconds) stop();
    }, 200);
  }, [maxSeconds, releaseStream, stop]);

  // Never leave the microphone open when the chat unmounts.
  useEffect(
    () => () => {
      cancelledRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseStream();
    },
    [releaseStream],
  );

  return { supported, state, elapsed, start, stop, cancel };
}
