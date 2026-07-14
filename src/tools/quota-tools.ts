import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { QuotaApi } from "../services/quota-api.js";
import { getNextSkipToken } from "../services/quota-api.js";
import { QualtricsConfig } from "../config/settings.js";
import {
  requireDeleteConfirmation,
  toolError,
  toolSuccess,
  withErrorHandling,
} from "./_helpers.js";

function pageElements(result: any): any[] {
  if (Array.isArray(result?.result)) return result.result;
  return Array.isArray(result?.result?.elements) ? result.result.elements : [];
}

function resultId(result: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = result?.result?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

const paginationSchema = {
  pageSize: z.number().int().positive().optional().describe(
    "Maximum number of definitions to return on this page"
  ),
  skipToken: z.string().min(1).optional().describe(
    "Opaque skip token or complete nextPage URL from the previous page"
  ),
};

export function registerQuotaTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const quotaApi = new QuotaApi(client);

  server.registerTool(
    "list_quotas",
    {
      description:
        "List complete quota definitions for a survey, including logic, limits, actions, schedules, and action options",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        ...paginationSchema,
      },
    },
    withErrorHandling("list_quotas", async (args) => {
      const result = await quotaApi.listQuotas(
        args.surveyId,
        args.pageSize,
        args.skipToken
      );
      const quotas = pageElements(result);

      return toolSuccess({
        surveyId: args.surveyId,
        quotas,
        returned: quotas.length,
        nextPage: result?.result?.nextPage ?? null,
        nextSkipToken: getNextSkipToken(result?.result?.nextPage) ?? null,
      });
    })
  );

  server.registerTool(
    "get_quota",
    {
      description:
        "Get a quota's complete raw Qualtrics definition, including its logic and actions",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        quotaId: z.string().min(1).describe("The quota ID (for example, QO_abc123)"),
      },
    },
    withErrorHandling("get_quota", async (args) => {
      const result = await quotaApi.getQuota(args.surveyId, args.quotaId);
      return toolSuccess({
        surveyId: args.surveyId,
        quotaId: args.quotaId,
        quota: result.result,
      });
    })
  );

  server.registerTool(
    "create_quota",
    {
      description:
        "Create a quota from a complete raw Qualtrics quota definition. Optionally add it to a quota group in the same operation.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        quota: z.record(z.any()).describe(
          "Complete Qualtrics quota payload; supports all fields such as Name, Occurrences, Logic, QuotaAction, schedules, and action options"
        ),
        quotaGroupId: z.string().min(1).optional().describe(
          "Optional quota group ID to add the new quota to"
        ),
      },
    },
    withErrorHandling("create_quota", async (args) => {
      const result = await quotaApi.createQuota(
        args.surveyId,
        args.quota,
        args.quotaGroupId
      );
      const quotaId = resultId(result, ["QuotaID", "QuotaId", "quotaId", "ID", "id"]);

      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        quotaId,
        quotaGroupId: args.quotaGroupId ?? null,
        message: "Quota created successfully",
        details: result.result,
      });
    })
  );

  server.registerTool(
    "update_quota",
    {
      description:
        "Replace a quota with a complete raw Qualtrics definition. Use get_quota first, modify the returned definition, and send the complete payload because PUT may replace omitted fields.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        quotaId: z.string().min(1).describe("The quota ID to update"),
        quota: z.record(z.any()).describe(
          "Complete replacement Qualtrics quota definition"
        ),
      },
    },
    withErrorHandling("update_quota", async (args) => {
      const result = await quotaApi.updateQuota(
        args.surveyId,
        args.quotaId,
        args.quota
      );
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        quotaId: args.quotaId,
        message: "Quota updated successfully",
        details: result.result,
      });
    })
  );

  server.registerTool(
    "delete_quota",
    {
      description: "Permanently delete a quota from a survey",
      annotations: { destructiveHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        quotaId: z.string().min(1).describe("The quota ID to delete"),
        confirmDelete: z.boolean().describe("Must be true to confirm deletion"),
      },
    },
    withErrorHandling("delete_quota", async (args) => {
      const guard = requireDeleteConfirmation(args);
      if (guard) return guard;

      const result = await quotaApi.deleteQuota(args.surveyId, args.quotaId);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        quotaId: args.quotaId,
        message: "Quota deleted successfully",
        details: result.result,
      });
    })
  );

  server.registerTool(
    "list_quota_groups",
    {
      description:
        "List complete quota-group definitions for a survey, including membership and multiple-match behavior",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        ...paginationSchema,
      },
    },
    withErrorHandling("list_quota_groups", async (args) => {
      const result = await quotaApi.listQuotaGroups(
        args.surveyId,
        args.pageSize,
        args.skipToken
      );
      const quotaGroups = pageElements(result);

      return toolSuccess({
        surveyId: args.surveyId,
        quotaGroups,
        returned: quotaGroups.length,
        nextPage: result?.result?.nextPage ?? null,
        nextSkipToken: getNextSkipToken(result?.result?.nextPage) ?? null,
      });
    })
  );

  server.registerTool(
    "get_quota_group",
    {
      description:
        "Get a quota group's complete raw Qualtrics definition, including its quota membership",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        quotaGroupId: z.string().min(1).describe(
          "The quota group ID (for example, QG_abc123)"
        ),
      },
    },
    withErrorHandling("get_quota_group", async (args) => {
      const result = await quotaApi.getQuotaGroup(
        args.surveyId,
        args.quotaGroupId
      );
      return toolSuccess({
        surveyId: args.surveyId,
        quotaGroupId: args.quotaGroupId,
        quotaGroup: result.result,
      });
    })
  );

  server.registerTool(
    "create_quota_group",
    {
      description:
        "Create a quota group from a complete raw Qualtrics quota-group definition",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        quotaGroup: z.record(z.any()).describe(
          "Complete Qualtrics quota-group payload; supports all fields such as Name, MultipleMatch, Public, Quotas, and Selected"
        ),
      },
    },
    withErrorHandling("create_quota_group", async (args) => {
      const result = await quotaApi.createQuotaGroup(
        args.surveyId,
        args.quotaGroup
      );
      const quotaGroupId = resultId(result, [
        "QuotaGroupID",
        "QuotaGroupId",
        "quotaGroupId",
        "ID",
        "Id",
        "id",
      ]);

      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        quotaGroupId,
        message: "Quota group created successfully",
        details: result.result,
      });
    })
  );

  server.registerTool(
    "update_quota_group",
    {
      description:
        "Replace a quota group with a complete raw Qualtrics definition. Use get_quota_group first, modify the returned definition, and send the complete payload because PUT may replace omitted fields.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        quotaGroupId: z.string().min(1).describe("The quota group ID to update"),
        quotaGroup: z.record(z.any()).describe(
          "Complete replacement Qualtrics quota-group definition"
        ),
      },
    },
    withErrorHandling("update_quota_group", async (args) => {
      const result = await quotaApi.updateQuotaGroup(
        args.surveyId,
        args.quotaGroupId,
        args.quotaGroup
      );
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        quotaGroupId: args.quotaGroupId,
        message: "Quota group updated successfully",
        details: result.result,
      });
    })
  );

  server.registerTool(
    "delete_quota_group",
    {
      description:
        "Permanently delete a quota group AND every quota in that group. Qualtrics documents this as a cascading delete; inspect membership first and explicitly acknowledge the cascade.",
      annotations: { destructiveHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        quotaGroupId: z.string().min(1).describe("The quota group ID to delete"),
        confirmDelete: z.boolean().describe(
          "Must be true to confirm deletion of the quota group"
        ),
        confirmCascade: z.boolean().describe(
          "Must be true to acknowledge that every quota in the group will also be deleted"
        ),
      },
    },
    withErrorHandling("delete_quota_group", async (args) => {
      const guard = requireDeleteConfirmation(args);
      if (guard) return guard;
      if (args.confirmCascade !== true) {
        return toolError(
          "Cascading destructive action: set confirmCascade to true to acknowledge deletion of the group and all quotas it contains."
        );
      }

      const result = await quotaApi.deleteQuotaGroup(
        args.surveyId,
        args.quotaGroupId
      );
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        quotaGroupId: args.quotaGroupId,
        message: "Quota group and all quotas it contained were deleted successfully",
        details: result.result,
      });
    })
  );
}
