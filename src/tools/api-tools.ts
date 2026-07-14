import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { toolError, toolSuccess, withErrorHandling } from "./_helpers.js";

const queryValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

/**
 * Keep advanced calls pinned to the configured Qualtrics v3 origin. The path
 * deliberately excludes query strings; callers provide query parameters in a
 * separate object so they are encoded safely.
 */
export function validateApiPath(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) {
    return "path must start with exactly one '/'";
  }
  if (path.includes("?") || path.includes("#") || path.includes("\\")) {
    return "path must not contain a query string, fragment, or backslash; use the query parameter instead";
  }
  if (path.includes("//") || (path.length > 1 && path.endsWith("/"))) {
    return "duplicate and trailing slashes are not allowed";
  }
  // URL parsers normalize encoded dot segments (for example %2e%2e), which
  // could otherwise escape the configured /API/v3 base path. Qualtrics IDs
  // and endpoint names do not require percent encoding; values belong in the
  // separately encoded query object or JSON body.
  if (path.includes("%")) {
    return "percent-encoded path segments are not allowed";
  }
  if (path.split("/").some((segment) => segment === "." || segment === "..")) {
    return "path traversal segments are not allowed";
  }
  if (/\s/.test(path)) {
    return "path must not contain whitespace";
  }
  return null;
}

function withQuery(
  path: string,
  query: Record<string, string | number | boolean | Array<string | number | boolean>> | undefined
): string {
  if (!query || Object.keys(query).length === 0) return path;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) params.append(key, String(item));
  }
  return `${path}?${params.toString()}`;
}

export function registerApiTools(server: McpServer, client: QualtricsClient) {
  server.registerTool(
    "qualtrics_api_request",
    {
      description:
        "Advanced escape hatch for any Qualtrics API v3 endpoint not covered by a dedicated tool. Requests stay on the configured Qualtrics origin. GET is available in read-only mode; otherwise-unmapped writes require the HIGH-risk 'advanced' write scope. Known endpoints still require their normal least-privilege scope. Prefer dedicated tools when available because they validate payloads and provide safer defaults.",
      annotations: { destructiveHint: true },
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("HTTP method"),
        path: z
          .string()
          .min(2)
          .describe("API v3 path beginning with '/', without the base URL or query string (for example, /directories)"),
        query: z.record(queryValue).optional().describe("Query parameters; array values produce repeated parameters"),
        body: z.unknown().optional().describe("JSON request body for POST, PUT, or PATCH"),
        confirmDelete: z
          .boolean()
          .optional()
          .describe("Must be true for DELETE requests"),
      },
    },
    withErrorHandling("qualtrics_api_request", async (args) => {
      const pathError = validateApiPath(args.path);
      if (pathError) return toolError(`Invalid Qualtrics API path: ${pathError}.`);

      if (args.method === "DELETE" && args.confirmDelete !== true) {
        return toolError("Destructive action: set confirmDelete to true to send a DELETE request.");
      }
      if (["GET", "DELETE"].includes(args.method) && args.body !== undefined) {
        return toolError(`${args.method} requests cannot include a body.`);
      }

      const endpoint = withQuery(args.path, args.query);
      const options: RequestInit = { method: args.method };
      if (args.body !== undefined) options.body = JSON.stringify(args.body);

      const response = await client.makeRequest<unknown>(endpoint, options, "advanced");
      return toolSuccess({
        method: args.method,
        endpoint,
        response,
      });
    })
  );
}
