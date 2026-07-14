import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { SurveyApi } from "../services/survey-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolError, toolSuccess, withErrorHandling } from "./_helpers.js";

export function registerSurveyTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const surveyApi = new SurveyApi(client);

  // List surveys tool
  server.registerTool(
    "list_surveys",
    {
      description: "List one Qualtrics-managed page of surveys with optional name filtering; use nextPage to continue",
      annotations: { readOnlyHint: true },
      inputSchema: {
        offset: z.number().optional().describe("Starting offset for pagination (default: 0)"),
        filter: z.string().optional().describe("Filter this returned page by name (case-insensitive partial match)"),
      },
    },
    withErrorHandling("list_surveys", async (args) => {
      const surveys = await client.getSurveys(args.offset ?? 0);

      let filteredSurveys = surveys.result.elements;
      if (args.filter) {
        const filterLower = args.filter.toLowerCase();
        filteredSurveys = filteredSurveys.filter(survey =>
          survey.name.toLowerCase().includes(filterLower)
        );
      }

      return toolSuccess({
        surveys: filteredSurveys.map(survey => ({
          id: survey.id,
          name: survey.name,
          isActive: survey.isActive,
          lastModified: survey.lastModified,
          creationDate: survey.creationDate,
        })),
        offset: args.offset ?? 0,
        returned: filteredSurveys.length,
        pageSize: surveys.result.elements.length,
        nextPage: surveys.result.nextPage ?? null,
        filterApplied: args.filter ?? null,
      });
    })
  );

  // Get survey tool
  server.registerTool(
    "get_survey",
    {
      description: "Get detailed information about a specific survey",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID (e.g., SV_123456789)"),
        includeDefinition: z.boolean().optional().describe("Include full survey definition with questions and logic (default: false)"),
      },
    },
    withErrorHandling("get_survey", async (args) => {
      const [surveyInfo, surveyDefinition] = await Promise.all([
        client.getSurvey(args.surveyId),
        args.includeDefinition ? client.getSurveyDefinition(args.surveyId) : null,
      ]);

      return toolSuccess({
        survey: surveyInfo.result,
        definition: surveyDefinition?.result || null,
      });
    })
  );

  // Create survey tool
  server.registerTool(
    "create_survey",
    {
      description: "Create a new survey in Qualtrics",
      annotations: { destructiveHint: false },
      inputSchema: {
        name: z.string().min(1).describe("Name for the new survey"),
        language: z.string().optional().describe("Survey language code (default: EN)"),
        projectCategory: z.string().optional().describe("Project category (default: CORE)"),
      },
    },
    withErrorHandling("create_survey", async (args) => {
      const surveyData = {
        SurveyName: args.name,
        Language: args.language ?? "EN",
        ProjectCategory: args.projectCategory ?? "CORE",
      };

      const result = await client.createSurvey(surveyData);

      return toolSuccess({
        success: true,
        surveyId: result.result.SurveyID,
        message: `Survey "${args.name}" created successfully`,
        details: result.result,
      });
    })
  );

  // Estimate export size tool
  server.registerTool(
    "estimate_export_size",
    {
      description: "Estimate export size from the survey's question count and an optional expected response count. Qualtrics survey metadata does not expose response totals, so omitting expectedResponseCount returns an honest per-response estimate.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        format: z.enum(["json", "csv"]).optional().describe("Export format to estimate (default: json)"),
        expectedResponseCount: z.number().int().nonnegative().optional().describe("Expected number of responses; omit for a per-response estimate"),
      },
    },
    withErrorHandling("estimate_export_size", async (args) => {
      const surveyDefinition = await client.getSurveyDefinition(args.surveyId);
      const questions = surveyDefinition.result.Questions ?? surveyDefinition.result.questions ?? {};
      const questionCount = Object.keys(questions).length;
      const responseCount = args.expectedResponseCount;
      const format = args.format ?? "json";

      const bytesPerResponseQuestion = format === "json" ? 500 : 50;
      const baseOverhead = format === "json" ? 10000 : 1000;
      const estimatedBytesPerResponse = questionCount * bytesPerResponseQuestion;
      const estimatedBytes = responseCount === undefined
        ? null
        : (responseCount * estimatedBytesPerResponse) + baseOverhead;
      const estimatedMB = estimatedBytes === null
        ? null
        : (estimatedBytes / (1024 * 1024)).toFixed(2);

      const isLargeExport = estimatedBytes !== null && estimatedBytes > 100 * 1024;
      const isVeryLargeExport = estimatedBytes !== null && estimatedBytes > 10 * 1024 * 1024;

      let recommendation = "";
      if (estimatedBytes === null) {
        recommendation = `Estimated ${estimatedBytesPerResponse} bytes per response. Supply expectedResponseCount for a total-size estimate.`;
      } else if (isVeryLargeExport) {
        recommendation = "VERY LARGE EXPORT EXPECTED: Strongly recommend using 'export_responses_filtered' with date ranges, specific questions, or a saved Qualtrics filter to reduce size. Also use 'saveToFile' parameter.";
      } else if (isLargeExport) {
        recommendation = "LARGE EXPORT EXPECTED: Consider using 'saveToFile' parameter to save directly to Downloads folder. The export will be automatically saved if it exceeds 100KB.";
      } else {
        recommendation = "SMALL EXPORT EXPECTED: Export will likely be returned directly, but you can still use 'saveToFile' if preferred.";
      }

      return toolSuccess({
        surveyId: args.surveyId,
        format,
        estimatedSize: {
          bytes: estimatedBytes,
          megabytes: estimatedMB,
          isLarge: isLargeExport,
          isVeryLarge: isVeryLargeExport,
        },
        surveyMetrics: {
          responseCount,
          questionCount,
          estimatedBytesPerResponse,
          estimationBasis: `${bytesPerResponseQuestion} bytes per response-question pair`,
        },
        recommendation,
        nextSteps: estimatedBytes === null
          ? "Rerun with expectedResponseCount, or start the export asynchronously and monitor it with check_export_status."
          : isVeryLargeExport
          ? "Consider using export_responses_filtered with filters like startDate, endDate, questionIds, or filterId to reduce size."
          : isLargeExport
            ? "Use export_responses with saveToFile='my_survey_data.csv' to save directly to Downloads folder."
            : "You can proceed with export_responses normally. Small file will be returned directly.",
      });
    })
  );

  // Update survey tool
  server.registerTool(
    "update_survey",
    {
      description: "Update survey metadata such as name, active status, or expiration",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        name: z.string().trim().min(1).optional().describe("New survey name"),
        isActive: z.boolean().optional().describe("Set survey active/inactive status"),
        expiration: z.string().optional().describe("Survey expiration date (ISO format)"),
      },
    },
    withErrorHandling("update_survey", async (args) => {
      const data: Record<string, any> = {};
      if (args.name !== undefined) data.name = args.name;
      if (args.isActive !== undefined) data.isActive = args.isActive;
      if (args.expiration !== undefined) data.expiration = { startDate: null, endDate: args.expiration };

      const result = await surveyApi.updateSurvey(args.surveyId, data);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        message: "Survey updated successfully",
        details: result.result,
      });
    })
  );

  // Delete survey tool
  server.registerTool(
    "delete_survey",
    {
      description: "Delete a survey. Requires name confirmation as a safety measure.",
      annotations: { destructiveHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        confirmName: z.string().min(1).describe("Type the survey name to confirm deletion"),
      },
    },
    withErrorHandling("delete_survey", async (args) => {
      // Verify the survey name matches
      const surveyInfo = await client.getSurvey(args.surveyId);
      const actualName = surveyInfo.result.name || surveyInfo.result.SurveyName;

      if (actualName !== args.confirmName) {
        return toolError(
          `Survey name mismatch. Expected "${actualName}" but got "${args.confirmName}". Deletion cancelled for safety.`
        );
      }

      const result = await surveyApi.deleteSurvey(args.surveyId);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        message: `Survey "${args.confirmName}" deleted successfully`,
        details: result.result,
      });
    })
  );

  // Activate survey tool
  server.registerTool(
    "activate_survey",
    {
      description: "Activate a survey to begin collecting responses",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("activate_survey", async (args) => {
      const result = await surveyApi.activateSurvey(args.surveyId);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        message: "Survey activated successfully",
        details: result.result,
      });
    })
  );

  // Deactivate survey tool
  server.registerTool(
    "deactivate_survey",
    {
      description: "Deactivate a survey to stop collecting responses",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("deactivate_survey", async (args) => {
      const result = await surveyApi.deactivateSurvey(args.surveyId);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        message: "Survey deactivated successfully",
        details: result.result,
      });
    })
  );
}
