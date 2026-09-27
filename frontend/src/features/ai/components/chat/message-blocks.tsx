"use client";

import { AlertCircle } from "lucide-react";
import type { ComponentType } from "react";

import { ChartBlock } from "@/features/ai/components/chat/chart-block";
import { ConfirmCard } from "@/features/ai/components/chat/confirm-card";
import { PlanBlock } from "@/features/ai/components/chat/plan-block";
import { ToolActivity } from "@/features/ai/components/chat/tool-activity";
import { errorKey } from "@/features/ai/lib/labels";
import { Markdown } from "@/features/ai/lib/markdown";
import type { AIUIBlock } from "@/features/ai/types";
import { useLocale } from "@/providers/locale-provider";

export type BlockRendererProps = { block: AIUIBlock };

function TextBlock({ block }: BlockRendererProps) {
  return block.text ? <Markdown text={block.text} /> : null;
}

function ErrorBlock({ block }: BlockRendererProps) {
  const { t } = useLocale();
  return (
    <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span>{t(errorKey(block.code))}</span>
    </div>
  );
}

function ChartRenderer({ block }: BlockRendererProps) {
  return block.chart ? <ChartBlock chart={block.chart} /> : null;
}

/** Block renderer registry; unknown types render nothing. */
export const blockRenderers: Record<
  string,
  ComponentType<BlockRendererProps>
> = {
  text: TextBlock,
  tool: ToolActivity,
  chart: ChartRenderer,
  error: ErrorBlock,
  confirm: ConfirmCard,
  todo_list: PlanBlock,
};

/** Tool indicators that are redundant next to their own block. */
const HIDDEN_TOOLS = new Set(["update_plan"]);

export function MessageBlocks({
  blocks,
  hidePlan = false,
}: {
  blocks: AIUIBlock[];
  /** Hide the plan checklist (a later message carries a newer one). */
  hidePlan?: boolean;
}) {
  const recoveredToolIds = new Set<string>();
  const laterSuccesses = new Set<string>();
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block.type !== "tool") continue;
    const name = block.name ?? "";
    if (!name) continue;
    if (block.status === "error" && laterSuccesses.has(name) && block.id) {
      recoveredToolIds.add(block.id);
    }
    if (block.status === "done") {
      laterSuccesses.add(name);
    }
  }

  // Consecutive tool indicators are grouped on one wrapped row.
  const groups: { key: string; tools?: AIUIBlock[]; block?: AIUIBlock }[] = [];
  blocks.forEach((block, index) => {
    const last = groups[groups.length - 1];
    if (block.type === "tool" && HIDDEN_TOOLS.has(block.name ?? "")) return;
    if (block.type === "todo_list" && hidePlan) return;
    if (block.type === "tool") {
      if (last?.tools) last.tools.push(block);
      else groups.push({ key: `g${index}`, tools: [block] });
      return;
    }
    groups.push({ key: `b${index}`, block });
  });

  return (
    <div className="space-y-2.5">
      {groups.map((group) => {
        if (group.tools) {
          return (
            <div key={group.key} className="flex flex-wrap gap-1.5">
              {group.tools.map((tool, i) => (
                <ToolActivity
                  key={tool.id ?? i}
                  block={tool}
                  recovered={Boolean(tool.id && recoveredToolIds.has(tool.id))}
                />
              ))}
            </div>
          );
        }
        const block = group.block as AIUIBlock;
        const Renderer = blockRenderers[block.type];
        return Renderer ? <Renderer key={group.key} block={block} /> : null;
      })}
    </div>
  );
}
