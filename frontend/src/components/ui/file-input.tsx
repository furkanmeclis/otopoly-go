"use client";

import { Upload } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

export type FileInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "children"
> & {
  /** Button text. Defaults to the localized "Choose file". */
  buttonLabel?: string;
  /**
   * Name shown next to the button. Pass it when the parent clears the
   * selection itself; otherwise the picked file names are shown.
   */
  fileName?: string | null;
};

/**
 * Drop-in for `<Input type="file">`: the native control stays hidden and a
 * localized Button opens the picker, so the browser's "Choose file / No file
 * chosen" widget never shows. `onChange` receives the native event unchanged.
 */
export const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
  ({ className, buttonLabel, fileName, disabled, onChange, ...props }, ref) => {
    const { t } = useLocale();
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const [picked, setPicked] = React.useState("");
    const shown = fileName !== undefined ? (fileName ?? "") : picked;

    const setRefs = (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    };

    return (
      <div className={cn("flex min-w-0 items-center gap-2", className)}>
        <input
          {...props}
          ref={setRefs}
          type="file"
          disabled={disabled}
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            setPicked(files.map((file) => file.name).join(", "));
            onChange?.(event);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          disabled={disabled}
          onClick={() => innerRef.current?.click()}
        >
          <Upload className="size-4" />
          {buttonLabel ?? t("common.choose_file")}
        </Button>
        <span
          className={cn(
            "min-w-0 truncate text-sm",
            !shown && "text-muted-foreground",
          )}
        >
          {shown || t("form.no_file_chosen")}
        </span>
      </div>
    );
  },
);
FileInput.displayName = "FileInput";
