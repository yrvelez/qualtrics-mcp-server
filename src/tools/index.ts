import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { QualtricsConfig } from "../config/settings.js";
import { registerSurveyTools } from "./survey-tools.js";
import { registerQuestionTools } from "./question-tools.js";
import { registerBlockTools } from "./block-tools.js";
import { registerResponseTools } from "./response-tools.js";
import { registerDistributionTools } from "./distribution-tools.js";
import { registerContactTools } from "./contact-tools.js";
import { registerUserTools } from "./user-tools.js";
import { registerWebhookTools } from "./webhook-tools.js";
import { registerFlowTools } from "./flow-tools.js";

export async function registerTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  registerSurveyTools(server, client, config);
  registerQuestionTools(server, client, config);
  registerBlockTools(server, client, config);
  registerResponseTools(server, client, config);
  registerDistributionTools(server, client, config);
  registerContactTools(server, client, config);
  registerUserTools(server, client, config);
  registerWebhookTools(server, client, config);
  registerFlowTools(server, client, config);
}
