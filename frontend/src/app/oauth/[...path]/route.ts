import { mcpPassthrough } from "@/lib/server/mcp-passthrough";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * MCP OAuth endpoints (docs/MCP.md): passthrough to Go `/oauth/*`
 * (authorize, register, token, revoke). `/oauth/consent` is a page and wins
 * over this catch-all.
 */
async function handle(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return mcpPassthrough(request, "/oauth", path ?? []);
}

export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
