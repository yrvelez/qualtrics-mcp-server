import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./config/settings.js";
import { QualtricsClient, ALL_WRITE_SCOPES, type WriteScope } from "./services/qualtrics-client.js";
import { registerTools } from "./tools/index.js";

const SCOPE_ENUM = z.enum([
  "users",
  "contacts",
  "surveys",
  "surveyDesign",
  "questionsAndBlocks",
  "distributions",
  "libraries",
  "advanced",
]);

export async function createQualtricsServer() {
  const config = await loadConfig();
  const qualtricsClient = new QualtricsClient(config);

  const scopeInfo = QualtricsClient.getScopeInfo();
  const scopeList = ALL_WRITE_SCOPES.map(s =>
    `  - "${s}" [${scopeInfo[s].risk} risk]: ${scopeInfo[s].description} — ${scopeInfo[s].riskNote}`
  ).join("\n");

  const readOnlyInstructions = qualtricsClient.readOnly
    ? `This server is running in READ-ONLY mode (the safe default). All write, update, and delete operations are blocked. If the user asks to create, update, or delete something, let them know they are in read-only mode and offer to enable only the specific write scopes they need using set_write_scopes. Available scopes (ordered by risk):\n${scopeList}\nIMPORTANT: Before enabling write scopes, clearly warn the user about the risk level of the scopes being enabled. HIGH risk scopes (users, contacts, surveys, advanced) may involve unrecoverable changes or data loss. Prefer enabling only the minimum scopes needed — e.g., if a user just needs to add questions, only enable "questionsAndBlocks" (LOW risk). Ask the user to confirm they understand the risks before proceeding.`
    : `This server is in READ-WRITE mode (all write scopes enabled). The user can call set_write_scopes to restrict or re-enable specific scopes at any time. Available scopes (ordered by risk):\n${scopeList}`;

  const server = new McpServer({
    name: "qualtrics-mcp-server",
    version: "1.0.0",
  }, {
    capabilities: {
      tools: {},
    },
    instructions: readOnlyInstructions,
  });

  // Register all domain tools
  await registerTools(server, qualtricsClient, config);

  // Register scoped write permissions tool
  server.registerTool(
    "set_write_scopes",
    {
      description: `Enable or disable write permissions for specific categories. Scopes by risk: HIGH (users, contacts, surveys, advanced), MEDIUM (surveyDesign, libraries), LOW (questionsAndBlocks), MINIMAL (distributions). Use this to grant only the minimum permissions needed.`,
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        scopes: z.array(SCOPE_ENUM).describe("List of scopes to enable for writing. Pass an empty array to go fully read-only."),
      },
    },
    async (args) => {
      qualtricsClient.writeScopes = new Set(args.scopes as WriteScope[]);
      const summary = qualtricsClient.getScopesSummary();
      const status = qualtricsClient.readOnly ? "READ-ONLY" : "WRITE-ENABLED";
      console.error(`Qualtrics MCP Server mode changed to ${status}`);

      let message: string;
      if (qualtricsClient.readOnly) {
        message = `All write scopes disabled. Server is now in READ-ONLY mode.`;
      } else {
        const hasHighRisk = (args.scopes as string[]).some(s =>
          ["users", "contacts", "surveys", "advanced"].includes(s)
        );
        const warning = hasHighRisk
          ? "\n\n⚠️ WARNING: You have enabled HIGH risk scopes. Operations in these scopes can permanently destroy Qualtrics data that CANNOT be recovered. Proceed with caution."
          : "\n\nYou can adjust scopes at any time using set_write_scopes.";
        message = `Write scopes updated.\n\n${summary}${warning}`;
      }
      return { content: [{ type: "text", text: message }] };
    }
  );

  // Keep backwards-compatible set_read_only_mode as a convenience alias
  server.registerTool(
    "set_read_only_mode",
    {
      description: "Quick toggle: enable read-only mode (blocks all writes) or disable it (enables all write scopes). For finer control, use set_write_scopes instead.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        enabled: z.boolean().describe("true to enable read-only mode, false to enable all write scopes"),
      },
    },
    async (args) => {
      qualtricsClient.readOnly = args.enabled;
      const summary = qualtricsClient.getScopesSummary();
      const status = args.enabled ? "READ-ONLY" : "READ-WRITE";
      console.error(`Qualtrics MCP Server mode changed to ${status}`);
      const message = args.enabled
        ? "Read-only mode enabled. Server is now in READ-ONLY mode. All write, update, and delete operations are blocked."
        : `⚠️ Read-only mode disabled. All write scopes are now enabled.\n\n${summary}\n\n⚠️ WARNING: This includes HIGH risk scopes (users, contacts, surveys, advanced) where destructive actions may be IRREVERSIBLE. Consider using set_write_scopes to enable only the scopes you need.`;
      return { content: [{ type: "text", text: message }] };
    }
  );

  if (config.server.readOnly) {
    console.error("Qualtrics MCP Server running in READ-ONLY mode");
  }

  return server;
}
