"use client";

import { Check, Copy, PlugZap, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { EntitySectionCard } from "@/components/entity";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/providers/locale-provider";
import { appToast } from "@/providers/toast-provider";

type ConnectGuideProps = {
  /** Public MCP endpoint URL (from GET /v1/mcp/info). */
  url?: string;
  kind: "org" | "platform";
  loading?: boolean;
};

function CopyField({ value, label }: { value: string; label: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      appToast.success(t("mcp.guide.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      appToast.error(t("mcp.guide.copy_failed"));
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={value}
        className="font-mono text-xs"
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => void copy()}
        aria-label={t("mcp.guide.copy")}
        title={t("mcp.guide.copy")}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-xs break-all">
      {children}
    </code>
  );
}

const CLIENTS = [
  {
    id: "claude",
    title: "mcp.guide.clients.claude.title",
    steps: [
      "mcp.guide.clients.claude.step1",
      "mcp.guide.clients.claude.step2",
      "mcp.guide.clients.claude.step3",
    ],
  },
  {
    id: "claude_code",
    title: "mcp.guide.clients.claude_code.title",
    steps: [
      "mcp.guide.clients.claude_code.step1",
      "mcp.guide.clients.claude_code.step2",
      "mcp.guide.clients.claude_code.step3",
    ],
  },
  {
    id: "cursor",
    title: "mcp.guide.clients.cursor.title",
    steps: [
      "mcp.guide.clients.cursor.step1",
      "mcp.guide.clients.cursor.step2",
      "mcp.guide.clients.cursor.step3",
    ],
  },
  {
    id: "vscode",
    title: "mcp.guide.clients.vscode.title",
    steps: [
      "mcp.guide.clients.vscode.step1",
      "mcp.guide.clients.vscode.step2",
      "mcp.guide.clients.vscode.step3",
    ],
  },
  {
    id: "chatgpt",
    title: "mcp.guide.clients.chatgpt.title",
    steps: [
      "mcp.guide.clients.chatgpt.step1",
      "mcp.guide.clients.chatgpt.step2",
      "mcp.guide.clients.chatgpt.step3",
    ],
  },
] as const;

type ClientId = (typeof CLIENTS)[number]["id"];

/**
 * How to connect an AI client (Claude, Cursor, …) to the MCP endpoint:
 * copy the URL, then client specific steps. The sign-in and consent happen
 * in Otopoly; no password or API key is shared.
 */
export function ConnectGuide({ url, kind, loading }: ConnectGuideProps) {
  const { t } = useLocale();
  const endpoint = url ?? "";

  const commands: Partial<Record<ClientId, string>> = {
    claude_code: `claude mcp add --transport http otopoly ${endpoint}`,
    cursor: `{"mcpServers": {"otopoly": {"url": "${endpoint}"}}}`,
  };

  return (
    <div className="space-y-4">
      <EntitySectionCard title={t("mcp.guide.url_title")}>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {t(
              kind === "org"
                ? "mcp.guide.url_hint_org"
                : "mcp.guide.url_hint_platform",
            )}
          </p>
          {loading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <CopyField value={endpoint} label={t("mcp.guide.url_title")} />
          )}
          <Alert>
            <ShieldCheck className="size-4" aria-hidden />
            <AlertTitle>{t("mcp.guide.security_title")}</AlertTitle>
            <AlertDescription>
              {t(
                kind === "org"
                  ? "mcp.guide.security_org"
                  : "mcp.guide.security_platform",
              )}
            </AlertDescription>
          </Alert>
        </div>
      </EntitySectionCard>

      <EntitySectionCard title={t("mcp.guide.steps_title")}>
        <Accordion type="single" collapsible defaultValue="claude">
          {CLIENTS.map((client) => (
            <AccordionItem key={client.id} value={client.id}>
              <AccordionTrigger>
                <span className="flex items-center gap-2">
                  <PlugZap
                    className="text-muted-foreground size-4"
                    aria-hidden
                  />
                  {t(client.title)}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
                  {client.steps.map((step) => (
                    <li key={step}>{t(step)}</li>
                  ))}
                </ol>
                {commands[client.id] && endpoint ? (
                  <div className="mt-3">
                    <Code>{commands[client.id] ?? ""}</Code>
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <p className="text-muted-foreground mt-3 text-xs">
          {t("mcp.guide.other_clients")}
        </p>
      </EntitySectionCard>
    </div>
  );
}
