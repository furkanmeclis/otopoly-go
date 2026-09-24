"use client";

import { ArrowUp, Square } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

type ComposerProps = {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /**
   * Extra controls left of the send button. Phase 3 mounts the push-to-talk
   * mic button here (it should call `onTranscript`-style APIs and then onSend).
   */
  actions?: ReactNode;
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
          const el = event.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
        }}
        onKeyDown={onKeyDown}
        className="placeholder:text-muted-foreground max-h-[180px] min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none disabled:opacity-50"
      />
      {actions}
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
