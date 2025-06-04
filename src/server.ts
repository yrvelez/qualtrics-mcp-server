import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, QualtricsConfig } from "./config/settings.js";
import { QualtricsClient } from "./services/qualtrics-client.js";
import { registerTools } from "./tools/index.js";

export async function createQualtricsServer() {
  const config = await loadConfig();
  const qualtricsClient = new QualtricsClient(config);

  const server = new McpServer({
    name: "qualtrics-mcp-server",
    version: "1.0.0",
  }, {
    capabilities: {
      tools: {},
    },
  });

  // Register all tools
  await registerTools(server, qualtricsClient, config);

  return server;
}