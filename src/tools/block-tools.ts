import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { SurveyApi } from "../services/survey-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolSuccess, withErrorHandling } from "./_helpers.js";

export function registerBlockTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const surveyApi = new SurveyApi(client);

  // List blocks
  server.tool(
    "list_blocks",
    "List all blocks in a survey",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
    },
    withErrorHandling("list_blocks", async (args) => {
      const result = await surveyApi.listBlocks(args.surveyId);
      const blocks = result.result.elements || result.result;

      const blockList = Array.isArray(blocks)
        ? blocks
        : Object.entries(blocks).map(([id, block]: [string, any]) => ({
            ID: id,
            ...block,
          }));

      return toolSuccess({
        surveyId: args.surveyId,
        blocks: blockList.map((b: any) => ({
          blockId: b.ID,
          description: b.Description,
          type: b.Type,
          questionCount: b.BlockElements?.filter((e: any) => e.Type === "Question").length || 0,
        })),
        total: blockList.length,
      });
    })
  );

  // Create block
  server.tool(
    "create_block",
    "Create a new block in a survey",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      description: z.string().min(1).describe("Block description/name"),
      type: z.string().optional().describe("Block type (default: Standard)"),
    },
    withErrorHandling("create_block", async (args) => {
      const data: Record<string, any> = {
        Description: args.description,
        Type: args.type ?? "Standard",
      };

      const result = await surveyApi.createBlock(args.surveyId, data);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        blockId: result.result.BlockID,
        message: `Block "${args.description}" created successfully`,
        details: result.result,
      });
    })
  );

  // Update block
  server.tool(
    "update_block",
    "Update a block's description or settings. The Qualtrics API requires a block Type in the body — if omitted, the current type is auto-fetched.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      blockId: z.string().min(1).describe("The block ID to update"),
      description: z.string().optional().describe("New block description"),
      type: z.string().optional().describe("Block type (e.g., Standard, Default, Trash). If omitted, the current type is auto-fetched."),
    },
    withErrorHandling("update_block", async (args) => {
      let blockType = args.type;
      if (!blockType) {
        const current = await surveyApi.getBlock(args.surveyId, args.blockId);
        blockType = current.result.Type;
      }

      const data: Record<string, any> = { Type: blockType };
      if (args.description !== undefined) data.Description = args.description;

      const result = await surveyApi.updateBlock(args.surveyId, args.blockId, data);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        blockId: args.blockId,
        message: "Block updated successfully",
        details: result.result,
      });
    })
  );

  // Delete block
  server.tool(
    "delete_block",
    "Remove a block from a survey",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      blockId: z.string().min(1).describe("The block ID to delete"),
    },
    withErrorHandling("delete_block", async (args) => {
      const result = await surveyApi.deleteBlock(args.surveyId, args.blockId);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        blockId: args.blockId,
        message: "Block deleted successfully",
        details: result.result,
      });
    })
  );
}
