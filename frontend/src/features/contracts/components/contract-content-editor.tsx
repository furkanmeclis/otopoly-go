"use client";

import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { LinkNode } from "@lexical/link";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable as LexicalContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $createHeadingNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import {
  Bold,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Underline,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";

import { editorTheme } from "@/components/editor/themes/editor-theme";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CONTRACT_VARIABLES } from "@/features/contract-presets/services/contract-presets.service";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

export type ContractContentValue = {
  content_json: unknown;
  content_html: string;
};

type ContractContentEditorProps = {
  initialJson?: unknown;
  initialHtml?: string;
  editable?: boolean;
  onChange: (value: ContractContentValue) => void;
  className?: string;
};

function isLexicalState(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const root = (value as { root?: unknown }).root;
  return Boolean(root && typeof root === "object");
}

function loadInitialState(
  editor: LexicalEditor,
  initialJson: unknown,
  initialHtml: string,
) {
  if (isLexicalState(initialJson)) {
    try {
      const parsed = editor.parseEditorState(JSON.stringify(initialJson));
      editor.setEditorState(parsed);
      return;
    } catch {
      // fall through
    }
  }

  editor.update(() => {
    const root = $getRoot();
    root.clear();
    const html = (initialHtml || "").trim();
    if (html && html !== "<p></p>") {
      const parser = new DOMParser();
      const dom = parser.parseFromString(html, "text/html");
      const nodes = $generateNodesFromDOM(editor, dom);
      if (nodes.length > 0) {
        $insertNodes(nodes);
        return;
      }
    }
    root.append($createParagraphNode());
  });
}

function InitialStatePlugin({
  initialJson,
  initialHtml,
}: {
  initialJson?: unknown;
  initialHtml?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    loadInitialState(editor, initialJson, initialHtml ?? "");
  }, [editor, initialHtml, initialJson]);

  return null;
}

function EditablePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(editable);
  }, [editor, editable]);
  return null;
}

function VariableInsertPlugin({
  insertRef,
}: {
  insertRef: MutableRefObject<((token: string) => void) | null>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    insertRef.current = (token: string) => {
      editor.focus();
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertText(token);
          return;
        }
        const root = $getRoot();
        const p = $createParagraphNode();
        root.append(p);
        p.selectEnd();
        const next = $getSelection();
        if ($isRangeSelection(next)) {
          next.insertText(token);
        }
      });
    };
    return () => {
      insertRef.current = null;
    };
  }, [editor, insertRef]);

  return null;
}

function Toolbar({
  editable,
  insertRef,
}: {
  editable: boolean;
  insertRef: MutableRefObject<((token: string) => void) | null>;
}) {
  const { t } = useLocale();
  const [editor] = useLexicalComposerContext();

  const setHeading = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode("h2"));
      }
    });
  }, [editor]);

  const setParagraph = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
  }, [editor]);

  const toggleBulletList = useCallback(() => {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  }, [editor]);

  const toggleNumberedList = useCallback(() => {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  }, [editor]);

  return (
    <div className="bg-muted/30 flex flex-col gap-2 border-b p-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!editable}
          aria-label={t("contracts.editor.bold")}
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
        >
          <Bold className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!editable}
          aria-label={t("contracts.editor.italic")}
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
        >
          <Italic className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!editable}
          aria-label={t("contracts.editor.underline")}
          onClick={() =>
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")
          }
        >
          <Underline className="size-4" />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!editable}
          aria-label={t("contracts.editor.heading")}
          onClick={setHeading}
        >
          <Heading2 className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!editable}
          className="h-8 px-2 text-xs"
          onClick={setParagraph}
        >
          {t("contracts.editor.paragraph")}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!editable}
          aria-label={t("contracts.editor.bullet_list")}
          onClick={toggleBulletList}
        >
          <List className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!editable}
          aria-label={t("contracts.editor.numbered_list")}
          onClick={toggleNumberedList}
        >
          <ListOrdered className="size-4" />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!editable}
          aria-label={t("contracts.editor.undo")}
          onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!editable}
          aria-label={t("contracts.editor.redo")}
          onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
        >
          <Redo2 className="size-4" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs">
          {t("contracts.editor.insert_field_hint")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {CONTRACT_VARIABLES.map((key) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant="secondary"
              disabled={!editable}
              className="h-7 text-xs"
              onClick={() => insertRef.current?.(`{{${key}}}`)}
            >
              {t(`contracts.variables.${key}`)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ContractContentEditor({
  initialJson,
  initialHtml = "",
  editable = true,
  onChange,
  className,
}: ContractContentEditorProps) {
  const { t } = useLocale();
  const skipFirst = useRef(true);
  const insertRef = useRef<((token: string) => void) | null>(null);

  const initialConfig = useMemo(
    () => ({
      namespace: "ContractContent",
      theme: editorTheme,
      editable,
      onError(error: Error) {
        console.error(error);
      },
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode],
    }),
    [editable],
  );

  return (
    <div
      className={cn(
        "bg-background overflow-hidden rounded-lg border shadow-xs",
        className,
      )}
    >
      <LexicalComposer initialConfig={initialConfig}>
        <Toolbar editable={editable} insertRef={insertRef} />
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <LexicalContentEditable
                aria-placeholder={t("contracts.editor.placeholder")}
                placeholder={
                  <div className="text-muted-foreground pointer-events-none absolute top-4 left-4 text-sm">
                    {t("contracts.editor.placeholder")}
                  </div>
                }
                className="prose prose-sm dark:prose-invert min-h-72 max-w-none px-4 py-3 outline-none"
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <InitialStatePlugin
          initialJson={initialJson}
          initialHtml={initialHtml}
        />
        <EditablePlugin editable={editable} />
        <VariableInsertPlugin insertRef={insertRef} />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState: EditorState, editor: LexicalEditor) => {
            if (skipFirst.current) {
              skipFirst.current = false;
              return;
            }
            editorState.read(() => {
              onChange({
                content_json: editorState.toJSON(),
                content_html: $generateHtmlFromNodes(editor, null),
              });
            });
          }}
        />
      </LexicalComposer>
    </div>
  );
}
