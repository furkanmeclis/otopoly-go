import { mcpPassthrough } from "@/lib/server/mcp-passthrough";

export const dynamic = "force-dynamic";
// Streamable HTTP may keep responses open.
export const maxDuration = 300;

type RouteContext = { params: Promise<{ path: string[] }> };

/** MCP endpoints (docs/MCP.md): streaming passthrough to Go `/mcp/*`. */
async function handle(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return mcpPassthrough(request, "/mcp", path ?? []);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
