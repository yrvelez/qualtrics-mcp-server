import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { ResponseApi } from "../services/response-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolError, toolSuccess, withErrorHandling, requireDeleteConfirmation } from "./_helpers.js";
import { consumeExportDownload } from "../utils/file-save.js";

export function exportJobState(result: any): {
  status: string;
  complete: boolean;
  failed: boolean;
  fileId: string | null;
} {
  const status = String(result?.status ?? "").toLowerCase();
  const fileId = typeof result?.fileId === "string" && result.fileId.length > 0
    ? result.fileId
    : null;
  return {
    status,
    complete: status === "complete" && fileId !== null,
    failed: status === "failed",
    fileId,
  };
}

export function registerResponseTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const responseApi = new ResponseApi(client);

  // Export responses tool
  server.registerTool(
    "export_responses",
    {
      description: "Export survey responses in JSON or CSV format. IMPORTANT: This tool will automatically save large exports to a local file to avoid context limits. Small exports may be returned directly. For better control over data size, consider using 'export_responses_filtered' with date ranges, specific questions, or a saved Qualtrics filter.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        format: z.enum(["json", "csv"]).optional().describe("Export format (default: json)"),
        waitForCompletion: z.boolean().optional().describe("Wait for export to complete before returning (default: true)"),
        saveToFile: z.string().optional().describe("RECOMMENDED: Specify a filename (e.g. 'survey_data.csv') to save the export to your Downloads folder. The tool will provide the full file path for easy access. If omitted, large files will be auto-saved with a timestamp."),
      },
    },
    async (args) => {
      const format = args.format ?? "json";
      try {
        const exportJob = await client.startResponseExport(args.surveyId, format);
        const progressId = exportJob.result.progressId;

        if (args.waitForCompletion === false) {
          return toolSuccess({
            status: "started",
            progressId,
            format,
            message: "Export started. Use check_export_status to monitor progress.",
          });
        }

        let attempts = 0;
        const maxAttempts = 30;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          const progress = await client.getResponseExportProgress(args.surveyId, progressId);
          const state = exportJobState(progress.result);

          if (state.failed) {
            return toolError(
              `Qualtrics response export failed at ${String(progress.result.percentComplete)}% (progressId ${progressId}).`
            );
          }
          if (state.complete) {
            const downloaded = await consumeExportDownload(
              client.downloadResponseExportChunks(args.surveyId, state.fileId!),
              args.surveyId,
              format,
              args.saveToFile
            );

            if (downloaded.savedToFile) {
              const message = downloaded.wasAutoSaved
                ? `Large export (${downloaded.fileSizeMB}MB) automatically saved to avoid context limits. File location: ${downloaded.savedToFile}`
                : `Export saved to ${downloaded.savedToFile}`;

              return toolSuccess({
                status: "completed",
                format,
                savedToFile: downloaded.savedToFile,
                fileSize: downloaded.fileSizeBytes,
                fileSizeMB: downloaded.fileSizeMB,
                wasAutoSaved: downloaded.wasAutoSaved,
                message,
                instructions: `The export file is now available at: ${downloaded.savedToFile}\n\nTo analyze this data:\n1. Navigate to your Downloads folder\n2. Open the file in your preferred tool (Excel, R, Python, etc.)\n3. Or drag and drop it into a data analysis application\n\nThe file is ready for immediate use!`,
                metadata: { progressId, fileId: state.fileId },
              });
            } else {
              const fileData = downloaded.data ?? "";
              return toolSuccess({
                status: "completed",
                format,
                fileSize: downloaded.fileSizeBytes,
                fileSizeMB: downloaded.fileSizeMB,
                data: format === "json" ? JSON.parse(fileData) : fileData,
                message: `Small export (${downloaded.fileSizeMB}MB) returned directly`,
                tip: "For larger exports, consider using the 'saveToFile' parameter to save directly to your Downloads folder for easier analysis.",
                metadata: { progressId, fileId: state.fileId },
              });
            }
          }
          attempts++;
        }

        return toolSuccess({
          status: "timeout",
          progressId,
          message: "Export is taking longer than expected. Use check_export_status to monitor.",
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const helpText = errorMessage.toLowerCase().includes("timeout") ||
          errorMessage.toLowerCase().includes("too large")
          ? " Try export_responses_filtered with a date range, selected questions, or a saved Qualtrics filter."
          : " The original export job was not silently retried; retry explicitly after addressing the error.";
        return toolError(`Error exporting responses: ${errorMessage}.${helpText}`);
      }
    }
  );

  // Check export status tool
  server.registerTool(
    "check_export_status",
    {
      description: "Check the status of a response export job",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        exportProgressId: z.string().min(1).describe("The export progress ID returned from export_responses"),
      },
    },
    withErrorHandling("check_export_status", async (args) => {
      const progress = await client.getResponseExportProgress(args.surveyId, args.exportProgressId);
      const state = exportJobState(progress.result);

      return toolSuccess({
        progressId: args.exportProgressId,
        percentComplete: progress.result.percentComplete,
        status: progress.result.status,
        isComplete: state.complete,
        isFailed: state.failed,
        fileId: state.fileId,
      });
    })
  );

  // Download a completed export by file ID
  server.registerTool(
    "download_export_file",
    {
      description:
        "Download a completed response export using the fileId returned by check_export_status. Saves large files automatically and can save any export to a requested filename.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        fileId: z.string().min(1).describe("Completed export file ID"),
        format: z.enum(["json", "csv"]).optional().describe("Export format (default: json)"),
        saveToFile: z.string().optional().describe("Optional filename in the Downloads folder"),
      },
    },
    withErrorHandling("download_export_file", async (args) => {
      const format = args.format ?? "json";
      const downloaded = await consumeExportDownload(
        client.downloadResponseExportChunks(args.surveyId, args.fileId),
        args.surveyId,
        format,
        args.saveToFile
      );

      if (downloaded.savedToFile) {
        return toolSuccess({
          status: "completed",
          surveyId: args.surveyId,
          fileId: args.fileId,
          format,
          savedToFile: downloaded.savedToFile,
          fileSize: downloaded.fileSizeBytes,
          fileSizeMB: downloaded.fileSizeMB,
          wasAutoSaved: downloaded.wasAutoSaved,
        });
      }

      const fileData = downloaded.data ?? "";
      let data: unknown = fileData;
      if (format === "json") {
        try {
          data = JSON.parse(fileData);
        } catch {
          // Preserve the raw payload so the caller can inspect malformed or
          // unexpectedly wrapped exports instead of losing the download.
        }
      }
      return toolSuccess({
        status: "completed",
        surveyId: args.surveyId,
        fileId: args.fileId,
        format,
        fileSize: downloaded.fileSizeBytes,
        data,
      });
    })
  );

  // Filtered export responses tool
  server.registerTool(
    "export_responses_filtered",
    {
      description: "Export survey responses with documented Qualtrics filters to reduce data size. Use date bounds, a saved Qualtrics filter, question selection, or inclusion of responses still in progress. Large exports will be automatically saved to your Downloads folder.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        format: z.enum(["json", "csv"]).optional().describe("Export format (default: json)"),
        waitForCompletion: z.boolean().optional().describe("Wait for export to complete before returning (default: true)"),
        saveToFile: z.string().optional().describe("RECOMMENDED: Specify a filename (e.g. 'filtered_survey.csv') to save the export to your Downloads folder."),
        startDate: z.string().optional().describe("Start date filter (ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)"),
        endDate: z.string().optional().describe("End date filter (ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)"),
        filterId: z.string().min(1).optional().describe("ID of a saved Qualtrics response filter"),
        includeResponsesInProgress: z.boolean().optional().describe("Include responses that are still in progress as well as recorded responses (Qualtrics exportResponsesInProgress; default: false)"),
        includeDisplayOrder: z.boolean().optional().describe("Include display-order fields in a CSV export (Qualtrics default when omitted: false)"),
        useLabels: z.boolean().optional().describe("Use choice labels instead of values (default: false)"),
        questionIds: z.array(z.string()).optional().describe("Specific question IDs to include (export only these questions) - HIGHLY RECOMMENDED for large surveys to reduce file size"),
        embeddedDataIds: z.array(z.string()).optional().describe("Specific embedded data fields to include - helps reduce unnecessary metadata"),
      },
    },
    async (args) => {
      const format = args.format ?? "json";
      const filters: Record<string, unknown> = {};
      try {
        if (
          format === "json" &&
          (args.includeDisplayOrder !== undefined || args.useLabels !== undefined)
        ) {
          return toolError(
            "includeDisplayOrder and useLabels are only supported for CSV exports; omit them or set format to 'csv'."
          );
        }
        if (args.startDate) filters.startDate = args.startDate;
        if (args.endDate) filters.endDate = args.endDate;
        if (args.filterId) filters.filterId = args.filterId;
        if (args.includeResponsesInProgress !== undefined) {
          filters.exportResponsesInProgress = args.includeResponsesInProgress;
        }
        if (args.includeDisplayOrder !== undefined) filters.includeDisplayOrder = args.includeDisplayOrder;
        if (args.useLabels !== undefined) filters.useLabels = args.useLabels;
        if (args.questionIds && args.questionIds.length > 0) filters.questionIds = args.questionIds;
        if (args.embeddedDataIds && args.embeddedDataIds.length > 0) filters.embeddedDataIds = args.embeddedDataIds;

        const exportJob = await client.startResponseExport(
          args.surveyId,
          format,
          Object.keys(filters).length > 0 ? filters : undefined
        );
        const progressId = exportJob.result.progressId;

        if (args.waitForCompletion === false) {
          return toolSuccess({
            status: "started",
            progressId,
            format,
            filters,
            message: "Filtered export started. Use check_export_status to monitor progress.",
          });
        }

        let attempts = 0;
        const maxAttempts = 30;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          const progress = await client.getResponseExportProgress(args.surveyId, progressId);
          const state = exportJobState(progress.result);

          if (state.failed) {
            return toolError(
              `Qualtrics filtered response export failed at ${String(progress.result.percentComplete)}% (progressId ${progressId}).`
            );
          }
          if (state.complete) {
            const downloaded = await consumeExportDownload(
              client.downloadResponseExportChunks(args.surveyId, state.fileId!),
              args.surveyId,
              format,
              args.saveToFile,
              "filtered"
            );

            if (downloaded.savedToFile) {
              const message = downloaded.wasAutoSaved
                ? `Large filtered export (${downloaded.fileSizeMB}MB) automatically saved to avoid context limits. File location: ${downloaded.savedToFile}`
                : `Filtered export saved to ${downloaded.savedToFile}`;

              return toolSuccess({
                status: "completed",
                format,
                filters,
                savedToFile: downloaded.savedToFile,
                fileSize: downloaded.fileSizeBytes,
                fileSizeMB: downloaded.fileSizeMB,
                wasAutoSaved: downloaded.wasAutoSaved,
                message,
                instructions: `The filtered export file is now available at: ${downloaded.savedToFile}\n\nTo analyze this data:\n1. Navigate to your Downloads folder\n2. Open the file in your preferred tool (Excel, R, Python, etc.)\n3. Or drag and drop it into a data analysis application\n\nThe file is ready for immediate use!`,
                metadata: { progressId, fileId: state.fileId },
              });
            } else {
              const fileData = downloaded.data ?? "";
              return toolSuccess({
                status: "completed",
                format,
                filters,
                fileSize: downloaded.fileSizeBytes,
                fileSizeMB: downloaded.fileSizeMB,
                data: format === "json" ? JSON.parse(fileData) : fileData,
                message: `Small filtered export (${downloaded.fileSizeMB}MB) returned directly`,
                tip: "For larger exports, consider using the 'saveToFile' parameter to save directly to your Downloads folder for easier analysis.",
                metadata: { progressId, fileId: state.fileId },
              });
            }
          }
          attempts++;
        }

        return toolSuccess({
          status: "timeout",
          progressId,
          filters,
          message: "Export is taking longer than expected. Use check_export_status to monitor.",
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return toolError(
          `Error exporting filtered responses: ${errorMessage}. ` +
          "The original export job was not silently retried; retry explicitly after addressing the error."
        );
      }
    }
  );

  // Get single response
  server.registerTool(
    "get_response",
    {
      description: "Get a single survey response by its response ID",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        responseId: z.string().min(1).describe("The response ID (e.g., R_123456789)"),
      },
    },
    withErrorHandling("get_response", async (args) => {
      const result = await responseApi.getResponse(args.surveyId, args.responseId);
      return toolSuccess({
        surveyId: args.surveyId,
        responseId: args.responseId,
        response: result.result,
      });
    })
  );

  // Create response
  server.registerTool(
    "create_response",
    {
      description: "Import/create a response for a survey programmatically",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        values: z.record(z.any()).describe("Response values keyed by question ID (e.g., { 'QID1': 1, 'QID2': 'text answer' })"),
        embeddedData: z.record(z.any()).optional().describe("Embedded data fields to include with the response"),
      },
    },
    withErrorHandling("create_response", async (args) => {
      const data: Record<string, any> = { values: args.values };
      if (args.embeddedData) data.embeddedData = args.embeddedData;

      const result = await responseApi.createResponse(args.surveyId, data);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        responseId: result.result.responseId,
        message: "Response created successfully",
        details: result.result,
      });
    })
  );

  // Update response embedded data through the current asynchronous batch API.
  server.registerTool(
    "update_response",
    {
      description: "Start a Qualtrics job to update embedded data on one existing survey response. The public API does not support rewriting recorded answer values through this operation; use create_response or response import for answer data.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        responseId: z.string().min(1).describe("The response ID to update"),
        embeddedData: z.record(z.string().max(1000)).refine(
          (data) => Object.keys(data).length > 0,
          "Provide at least one embedded-data field"
        ).describe("Embedded-data fields to update; Qualtrics requires string values of at most 1000 characters"),
        resetRecordedDate: z.boolean().optional().describe("Reset the response recorded date when the job runs (default: false)"),
      },
    },
    withErrorHandling("update_response", async (args) => {
      const result = await responseApi.updateResponseEmbeddedData(
        args.surveyId,
        args.responseId,
        args.embeddedData,
        args.resetRecordedDate ?? false
      );
      const progressId = result.result?.progressId;
      return toolSuccess({
        accepted: true,
        surveyId: args.surveyId,
        responseId: args.responseId,
        progressId,
        statusEndpoint: progressId
          ? `/surveys/${args.surveyId}/update-responses/${progressId}`
          : null,
        message: progressId
          ? "Embedded-data update job accepted. Poll statusEndpoint with qualtrics_api_request until the job completes."
          : "Embedded-data update job accepted, but Qualtrics did not return a progressId.",
        details: result.result,
      });
    })
  );

  // Delete response
  server.registerTool(
    "delete_response",
    {
      description: "Delete a survey response",
      annotations: { destructiveHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        responseId: z.string().min(1).describe("The response ID to delete"),
        confirmDelete: z.boolean().describe("Must be true to confirm deletion"),
      },
    },
    withErrorHandling("delete_response", async (args) => {
      const guard = requireDeleteConfirmation(args);
      if (guard) return guard;
      const result = await responseApi.deleteResponse(args.surveyId, args.responseId);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        responseId: args.responseId,
        message: "Response deleted successfully",
        details: result.result,
      });
    })
  );
}
