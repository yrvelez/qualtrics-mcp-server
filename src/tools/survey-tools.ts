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
  server.tool(
    "list_surveys",
    "List surveys with optional filtering and pagination",
    {
      offset: z.number().optional().describe("Starting offset for pagination (default: 0)"),
      limit: z.number().max(100).optional().describe("Maximum number of surveys to return (max: 100, default: 20)"),
      filter: z.string().optional().describe("Filter surveys by name (case-insensitive partial match)"),
    },
    withErrorHandling("list_surveys", async (args) => {
      const surveys = await client.getSurveys(args.offset ?? 0, args.limit ?? 20);

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
        total: surveys.result.totalElements,
        offset: args.offset ?? 0,
        limit: args.limit ?? 20,
        filtered: args.filter ? filteredSurveys.length : surveys.result.elements.length,
      });
    })
  );

  // Get survey tool
  server.tool(
    "get_survey",
    "Get detailed information about a specific survey",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID (e.g., SV_123456789)"),
      includeDefinition: z.boolean().optional().describe("Include full survey definition with questions and logic (default: false)"),
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
  server.tool(
    "create_survey",
    "Create a new survey in Qualtrics",
    {
      name: z.string().min(1).describe("Name for the new survey"),
      language: z.string().optional().describe("Survey language code (default: EN)"),
      projectCategory: z.string().optional().describe("Project category (default: CORE)"),
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
  server.tool(
    "estimate_export_size",
    "Estimate the size of a survey export before downloading. Helps you decide whether to use saveToFile parameter or apply filters to reduce size.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      format: z.enum(["json", "csv"]).optional().describe("Export format to estimate (default: json)"),
    },
    withErrorHandling("estimate_export_size", async (args) => {
      const [surveyInfo, surveyDefinition] = await Promise.all([
        client.getSurvey(args.surveyId),
        client.getSurveyDefinition(args.surveyId),
      ]);

      const responseCount = surveyInfo.result.responseExportTotal || 0;
      const questionCount = surveyDefinition.result.questions ? Object.keys(surveyDefinition.result.questions).length : 0;

      const bytesPerResponseQuestion = args.format === "json" ? 500 : 50;
      const baseOverhead = args.format === "json" ? 10000 : 1000;
      const estimatedBytes = (responseCount * questionCount * bytesPerResponseQuestion) + baseOverhead;
      const estimatedMB = (estimatedBytes / (1024 * 1024)).toFixed(2);

      const isLargeExport = estimatedBytes > 100 * 1024;
      const isVeryLargeExport = estimatedBytes > 10 * 1024 * 1024;

      let recommendation = "";
      if (isVeryLargeExport) {
        recommendation = "VERY LARGE EXPORT EXPECTED: Strongly recommend using 'export_responses_filtered' with date ranges, specific questions, or completion filters to reduce size. Also use 'saveToFile' parameter.";
      } else if (isLargeExport) {
        recommendation = "LARGE EXPORT EXPECTED: Consider using 'saveToFile' parameter to save directly to Downloads folder. The export will be automatically saved if it exceeds 100KB.";
      } else {
        recommendation = "SMALL EXPORT EXPECTED: Export will likely be returned directly, but you can still use 'saveToFile' if preferred.";
      }

      return toolSuccess({
        surveyId: args.surveyId,
        format: args.format,
        estimatedSize: {
          bytes: estimatedBytes,
          megabytes: estimatedMB,
          isLarge: isLargeExport,
          isVeryLarge: isVeryLargeExport,
        },
        surveyMetrics: {
          responseCount,
          questionCount,
          estimationBasis: `${bytesPerResponseQuestion} bytes per response-question pair`,
        },
        recommendation,
        nextSteps: isVeryLargeExport
          ? "Consider using export_responses_filtered with filters like: startDate, endDate, questionIds, or filterType to reduce size."
          : isLargeExport
            ? "Use export_responses with saveToFile='my_survey_data.csv' to save directly to Downloads folder."
            : "You can proceed with export_responses normally. Small file will be returned directly.",
      });
    })
  );

  // Update survey tool
  server.tool(
    "update_survey",
    "Update survey metadata such as name, active status, or expiration",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      name: z.string().optional().describe("New survey name"),
      isActive: z.boolean().optional().describe("Set survey active/inactive status"),
      expiration: z.string().optional().describe("Survey expiration date (ISO format)"),
    },
    withErrorHandling("update_survey", async (args) => {
      const data: Record<string, any> = {};
      if (args.name !== undefined) data.SurveyName = args.name;
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
  server.tool(
    "delete_survey",
    "Delete a survey. Requires name confirmation as a safety measure.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      confirmName: z.string().min(1).describe("Type the survey name to confirm deletion"),
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
  server.tool(
    "activate_survey",
    "Activate a survey to begin collecting responses",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
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
  server.tool(
    "deactivate_survey",
    "Deactivate a survey to stop collecting responses",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
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
