"use client";

import { ArrowUp, Square } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/** Handle given to composer actions (e.g. the push-to-talk mic). */
export type ComposerApi = {
  /** Appends text to the draft and focuses the textarea. */
  insertText: (text: string) => void;
};

function autoSize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
}

type ComposerProps = {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /**
   * Extra controls left of the send button (the push-to-talk mic). A render
   * function receives a {@link ComposerApi} to write into the draft.
   */
  actions?: ReactNode | ((api: ComposerApi) => ReactNode);
  className?: string;
};

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  autoFocus,
  actions,
  className,
}: ComposerProps) {
  const { t } = useLocale();
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Bumped by insertText; the effect resizes and focuses after the update.
  const [inserted, setInserted] = useState(0);

  const insertText = useCallback((text: string) => {
    setValue((prev) => {
      const base = prev.trimEnd();
      return base ? `${base} ${text}` : text;
    });
    setInserted((n) => n + 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!inserted || !el) return;
    autoSize(el);
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [inserted]);

  const submit = () => {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    onSend(text);
    setValue("");
    if (ref.current) ref.current.style.height = "";
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div
      className={cn(
        "bg-background focus-within:ring-ring/40 flex items-end gap-2 rounded-xl border p-2 shadow-xs focus-within:ring-2",
        className,
      )}
    >
      <textarea
        ref={ref}
        value={value}
        rows={1}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={t("ai.assistant.placeholder")}
        aria-label={t("ai.assistant.placeholder")}
        onChange={(event) => {
          setValue(event.target.value);
          autoSize(event.target);
        }}
        onKeyDown={onKeyDown}
        className="placeholder:text-muted-foreground max-h-[180px] min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none disabled:opacity-50"
      />
      {typeof actions === "function" ? actions({ insertText }) : actions}
      {streaming ? (
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          onClick={onStop}
          aria-label={t("ai.assistant.stop")}
          title={t("ai.assistant.stop")}
        >
          <Square className="size-3.5 fill-current" />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon-sm"
          onClick={submit}
          disabled={disabled || !value.trim()}
          aria-label={t("ai.assistant.send")}
          title={t("ai.assistant.send")}
        >
          <ArrowUp className="size-4" />
        </Button>
      )}
    </div>
  );
}
