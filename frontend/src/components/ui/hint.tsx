"use client";

import type { ComponentProps, ReactElement, ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type HintProps = {
  /** Tooltip text. Empty / nullish renders the child alone, without a tooltip. */
  label?: ReactNode;
  /** A single element that accepts a ref and DOM props (span, button, Button, Badge...). */
  children: ReactElement;
  side?: ComponentProps<typeof TooltipContent>["side"];
  align?: ComponentProps<typeof TooltipContent>["align"];
  className?: string;
  /** Hover delay before the tooltip opens. */
  delayDuration?: number;
  /**
   * Wrap a disabled child in a focusable span so the hint still shows.
   * Turn off where an extra wrapper would break the parent layout
   * (e.g. ButtonGroup child selectors).
   */
  wrapDisabled?: boolean;
};

/**
 * Styled replacement for the native `title=""` tooltip on DOM elements.
 * Icon-only controls still need their own `aria-label`; this only adds the
 * visual hint.
 */
export function Hint({
  label,
  children,
  side,
  align,
  className,
  delayDuration = 300,
  wrapDisabled = true,
}: HintProps) {
  if (label === undefined || label === null || label === "" || label === false)
    return children;
  // A disabled control gets no pointer or focus events, so the hint (often the
  // reason it is disabled) hangs on a focusable wrapper instead.
  const disabled =
    wrapDisabled &&
    Boolean((children.props as { disabled?: boolean } | null)?.disabled);
  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>
        {disabled ? (
          <span tabIndex={0} className="inline-flex">
            {children}
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        className={cn("max-w-xs break-words", className)}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
