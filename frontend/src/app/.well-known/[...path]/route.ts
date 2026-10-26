import { mcpPassthrough } from "@/lib/server/mcp-passthrough";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * RFC 8414 / RFC 9728 metadata of the MCP authorization server (docs/MCP.md):
 * passthrough to Go `/.well-known/*`.
 */
async function handle(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return mcpPassthrough(request, "/.well-known", path ?? []);
}

export const GET = handle;
export const OPTIONS = handle;
