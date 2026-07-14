import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { SurveyApi } from "../services/survey-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolSuccess, withErrorHandling, requireDeleteConfirmation } from "./_helpers.js";

export function registerBlockTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const surveyApi = new SurveyApi(client);

  // List blocks
  server.registerTool(
    "list_blocks",
    {
      description: "List all blocks in a survey",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
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

  // Get block
  server.registerTool(
    "get_block",
    {
      description:
        "Get a block's complete definition, including question order, skip logic, randomization, loop-and-merge, and navigation options",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        blockId: z.string().min(1).describe("The block ID (for example, BL_abc123)"),
      },
    },
    withErrorHandling("get_block", async (args) => {
      const result = await surveyApi.getBlock(args.surveyId, args.blockId);
      return toolSuccess({
        surveyId: args.surveyId,
        blockId: args.blockId,
        block: result.result,
      });
    })
  );

  // Create block
  server.registerTool(
    "create_block",
    {
      description:
        "Create a new block. Supports complete Qualtrics block definitions for reference blocks, question ordering, skip logic, randomization, and loop-and-merge.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        description: z.string().min(1).describe("Block description/name"),
        type: z.string().optional().describe("Block type (default: Standard)"),
        subType: z.string().optional().describe("Block subtype, such as Reference"),
        blockElements: z.array(z.any()).optional().describe("Initial BlockElements array, including question references, page breaks, and skip logic"),
        options: z.record(z.any()).optional().describe("Block Options, including RandomizeQuestions, Randomization, Looping, and LoopingOptions"),
        additionalFields: z.record(z.any()).optional().describe("Other Qualtrics block-definition fields, merged into the request last"),
      },
    },
    withErrorHandling("create_block", async (args) => {
      const data: Record<string, any> = {
        Description: args.description,
        Type: args.type ?? "Standard",
      };
      if (args.subType !== undefined) data.SubType = args.subType;
      if (args.blockElements !== undefined) data.BlockElements = args.blockElements;
      if (args.options !== undefined) data.Options = args.options;
      if (args.additionalFields) Object.assign(data, args.additionalFields);

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
  server.registerTool(
    "update_block",
    {
      description:
        "Safely update part of a block definition. The current block is fetched and carried forward because Qualtrics PUT replaces the complete block. Supports question ordering, skip logic, randomization, and loop-and-merge.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        blockId: z.string().min(1).describe("The block ID to update"),
        description: z.string().optional().describe("New block description"),
        type: z.string().optional().describe("Block type (e.g., Standard, Default, Trash)"),
        subType: z.string().optional().describe("Block subtype, such as Reference"),
        blockElements: z.array(z.any()).optional().describe("Replacement BlockElements array controlling question order, page breaks, and skip logic"),
        options: z.record(z.any()).optional().describe("Replacement Options object controlling randomization, loop-and-merge, and navigation"),
        additionalFields: z.record(z.any()).optional().describe("Other block-definition fields, merged into the request last"),
      },
    },
    withErrorHandling("update_block", async (args) => {
      const current = await surveyApi.getBlock(args.surveyId, args.blockId);
      const data: Record<string, any> = { ...current.result };
      if (args.description !== undefined) data.Description = args.description;
      if (args.type !== undefined) data.Type = args.type;
      if (args.subType !== undefined) data.SubType = args.subType;
      if (args.blockElements !== undefined) data.BlockElements = args.blockElements;
      if (args.options !== undefined) data.Options = args.options;
      if (args.additionalFields) Object.assign(data, args.additionalFields);

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
  server.registerTool(
    "delete_block",
    {
      description: "Remove a block from a survey",
      annotations: { destructiveHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        blockId: z.string().min(1).describe("The block ID to delete"),
        confirmDelete: z.boolean().describe("Must be true to confirm deletion"),
      },
    },
    withErrorHandling("delete_block", async (args) => {
      const guard = requireDeleteConfirmation(args);
      if (guard) return guard;
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
