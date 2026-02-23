import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { ResponseApi } from "../services/response-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolSuccess, withErrorHandling } from "./_helpers.js";
import { saveExportToFile } from "../utils/file-save.js";

export function registerResponseTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const responseApi = new ResponseApi(client);

  // Export responses tool
  server.tool(
    "export_responses",
    "Export survey responses in JSON or CSV format. IMPORTANT: This tool will automatically save large exports to a local file to avoid context limits. Small exports may be returned directly. For better control over data size, consider using 'export_responses_filtered' with date ranges, specific questions, or completion filters.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      format: z.enum(["json", "csv"]).optional().describe("Export format (default: json)"),
      waitForCompletion: z.boolean().optional().describe("Wait for export to complete before returning (default: true)"),
      saveToFile: z.string().optional().describe("RECOMMENDED: Specify a filename (e.g. 'survey_data.csv') to save the export to your Downloads folder. The tool will provide the full file path for easy access. If omitted, large files will be auto-saved with a timestamp."),
    },
    async (args) => {
      try {
        const exportJob = await client.startResponseExport(args.surveyId, args.format ?? "json");
        const progressId = exportJob.result.progressId;

        if (!args.waitForCompletion) {
          return toolSuccess({
            status: "started",
            progressId,
            message: "Export started. Use check_export_status to monitor progress.",
          });
        }

        let attempts = 0;
        const maxAttempts = 30;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          const progress = await client.getResponseExportProgress(args.surveyId, progressId);

          if (progress.result.percentComplete === 100) {
            const fileData = await client.downloadResponseExportFile(args.surveyId, progress.result.fileId);
            const fileSizeBytes = Buffer.byteLength(fileData, "utf8");
            const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
            const isLargeFile = fileSizeBytes > 100 * 1024;

            if (args.saveToFile || isLargeFile) {
              const saved = await saveExportToFile(fileData, args.surveyId, args.format ?? "json", args.saveToFile);
              const message = saved.wasAutoSaved
                ? `Large export (${saved.fileSizeMB}MB) automatically saved to avoid context limits. File location: ${saved.filePath}`
                : `Export saved to ${saved.filePath}`;

              return toolSuccess({
                status: "completed",
                format: args.format,
                savedToFile: saved.filePath,
                fileSize: saved.fileSizeBytes,
                fileSizeMB: saved.fileSizeMB,
                wasAutoSaved: saved.wasAutoSaved,
                message,
                instructions: `The export file is now available at: ${saved.filePath}\n\nTo analyze this data:\n1. Navigate to your Downloads folder\n2. Open the file in your preferred tool (Excel, R, Python, etc.)\n3. Or drag and drop it into a data analysis application\n\nThe file is ready for immediate use!`,
                metadata: { progressId, fileId: progress.result.fileId },
              });
            } else {
              return toolSuccess({
                status: "completed",
                format: args.format,
                fileSize: fileSizeBytes,
                fileSizeMB,
                data: args.format === "json" ? JSON.parse(fileData) : fileData,
                message: `Small export (${fileSizeMB}MB) returned directly`,
                tip: "For larger exports, consider using the 'saveToFile' parameter to save directly to your Downloads folder for easier analysis.",
                metadata: { progressId, fileId: progress.result.fileId },
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

        try {
          const fallbackJob = await client.startResponseExport(args.surveyId, "csv");
          const fallbackProgressId = fallbackJob.result.progressId;

          let attempts = 0;
          const maxAttempts = 30;

          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            const progress = await client.getResponseExportProgress(args.surveyId, fallbackProgressId);

            if (progress.result.percentComplete === 100) {
              const fileData = await client.downloadResponseExportFile(args.surveyId, progress.result.fileId);
              const saved = await saveExportToFile(fileData, args.surveyId, "csv");

              return toolSuccess({
                status: "completed_via_fallback",
                originalError: errorMessage,
                format: "csv",
                savedToFile: saved.filePath,
                fileSize: saved.fileSizeBytes,
                message: `Original export failed, but CSV export succeeded and was saved to: ${saved.filePath}`,
                metadata: { fallbackProgressId, fileId: progress.result.fileId },
              });
            }
            attempts++;
          }

          return toolSuccess({
            status: "fallback_timeout",
            originalError: errorMessage,
            progressId: fallbackProgressId,
            message: "Both original export and CSV fallback are taking longer than expected. Use check_export_status to monitor the CSV export progress.",
          });
        } catch (fallbackError) {
          const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          const helpText = errorMessage.toLowerCase().includes("timeout") || errorMessage.toLowerCase().includes("too large")
            ? " TIP: Try using 'export_responses_filtered' with date ranges, specific questions, or completion filters to reduce file size."
            : " You may need to log into Qualtrics directly to export manually if the issue persists.";

          return {
            content: [{ type: "text" as const, text: `Error exporting responses: ${errorMessage}. CSV fallback also failed: ${fallbackErrorMessage}.${helpText}` }],
            isError: true,
          };
        }
      }
    }
  );

  // Check export status tool
  server.tool(
    "check_export_status",
    "Check the status of a response export job",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      exportProgressId: z.string().min(1).describe("The export progress ID returned from export_responses"),
    },
    withErrorHandling("check_export_status", async (args) => {
      const progress = await client.getResponseExportProgress(args.surveyId, args.exportProgressId);

      return toolSuccess({
        progressId: args.exportProgressId,
        percentComplete: progress.result.percentComplete,
        status: progress.result.status,
        isComplete: progress.result.percentComplete === 100,
        fileId: progress.result.fileId || null,
      });
    })
  );

  // Filtered export responses tool
  server.tool(
    "export_responses_filtered",
    "Export survey responses with filters to reduce data size. RECOMMENDED for large surveys or when analyzing specific subsets. Use date filters, question selection, or completion status to create manageable datasets for analysis. Large exports will be automatically saved to your Downloads folder.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      format: z.enum(["json", "csv"]).optional().describe("Export format (default: json)"),
      waitForCompletion: z.boolean().optional().describe("Wait for export to complete before returning (default: true)"),
      saveToFile: z.string().optional().describe("RECOMMENDED: Specify a filename (e.g. 'filtered_survey.csv') to save the export to your Downloads folder."),
      startDate: z.string().optional().describe("Start date filter (ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)"),
      endDate: z.string().optional().describe("End date filter (ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)"),
      filterType: z.enum(["complete", "incomplete", "all"]).optional().describe("Response completion filter (default: all)"),
      includeDisplayOrder: z.boolean().optional().describe("Include display order in export (default: true)"),
      useLabels: z.boolean().optional().describe("Use choice labels instead of values (default: false)"),
      questionIds: z.array(z.string()).optional().describe("Specific question IDs to include (export only these questions) - HIGHLY RECOMMENDED for large surveys to reduce file size"),
      embeddedDataIds: z.array(z.string()).optional().describe("Specific embedded data fields to include - helps reduce unnecessary metadata"),
    },
    async (args) => {
      try {
        const filters: any = {};
        if (args.startDate) filters.startDate = args.startDate;
        if (args.endDate) filters.endDate = args.endDate;
        if (args.filterType && args.filterType !== "all") {
          filters.filterType = args.filterType === "complete" ? "finished" : "unfinished";
        }
        if (args.includeDisplayOrder !== undefined) filters.includeDisplayOrder = args.includeDisplayOrder;
        if (args.useLabels !== undefined) filters.useLabels = args.useLabels;
        if (args.questionIds && args.questionIds.length > 0) filters.questionIds = args.questionIds;
        if (args.embeddedDataIds && args.embeddedDataIds.length > 0) filters.embeddedDataIds = args.embeddedDataIds;

        const exportJob = await client.startResponseExport(
          args.surveyId,
          args.format ?? "json",
          Object.keys(filters).length > 0 ? filters : undefined
        );
        const progressId = exportJob.result.progressId;

        if (!args.waitForCompletion) {
          return toolSuccess({
            status: "started",
            progressId,
            filters,
            message: "Filtered export started. Use check_export_status to monitor progress.",
          });
        }

        let attempts = 0;
        const maxAttempts = 30;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          const progress = await client.getResponseExportProgress(args.surveyId, progressId);

          if (progress.result.percentComplete === 100) {
            const fileData = await client.downloadResponseExportFile(args.surveyId, progress.result.fileId);
            const fileSizeBytes = Buffer.byteLength(fileData, "utf8");
            const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
            const isLargeFile = fileSizeBytes > 100 * 1024;

            if (args.saveToFile || isLargeFile) {
              const saved = await saveExportToFile(fileData, args.surveyId, args.format ?? "json", args.saveToFile, "filtered");
              const message = saved.wasAutoSaved
                ? `Large filtered export (${saved.fileSizeMB}MB) automatically saved to avoid context limits. File location: ${saved.filePath}`
                : `Filtered export saved to ${saved.filePath}`;

              return toolSuccess({
                status: "completed",
                format: args.format,
                filters,
                savedToFile: saved.filePath,
                fileSize: saved.fileSizeBytes,
                fileSizeMB: saved.fileSizeMB,
                wasAutoSaved: saved.wasAutoSaved,
                message,
                instructions: `The filtered export file is now available at: ${saved.filePath}\n\nTo analyze this data:\n1. Navigate to your Downloads folder\n2. Open the file in your preferred tool (Excel, R, Python, etc.)\n3. Or drag and drop it into a data analysis application\n\nThe file is ready for immediate use!`,
                metadata: { progressId, fileId: progress.result.fileId },
              });
            } else {
              return toolSuccess({
                status: "completed",
                format: args.format,
                filters,
                fileSize: fileSizeBytes,
                fileSizeMB,
                data: args.format === "json" ? JSON.parse(fileData) : fileData,
                message: `Small filtered export (${fileSizeMB}MB) returned directly`,
                tip: "For larger exports, consider using the 'saveToFile' parameter to save directly to your Downloads folder for easier analysis.",
                metadata: { progressId, fileId: progress.result.fileId },
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

        try {
          const fallbackFilters: any = {};
          if (args.startDate) fallbackFilters.startDate = args.startDate;
          if (args.endDate) fallbackFilters.endDate = args.endDate;
          if (args.filterType && args.filterType !== "all") {
            fallbackFilters.filterType = args.filterType === "complete" ? "finished" : "unfinished";
          }

          const fallbackJob = await client.startResponseExport(
            args.surveyId,
            "csv",
            Object.keys(fallbackFilters).length > 0 ? fallbackFilters : undefined
          );
          const fallbackProgressId = fallbackJob.result.progressId;

          let attempts = 0;
          const maxAttempts = 30;

          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            const progress = await client.getResponseExportProgress(args.surveyId, fallbackProgressId);

            if (progress.result.percentComplete === 100) {
              const fileData = await client.downloadResponseExportFile(args.surveyId, progress.result.fileId);
              const saved = await saveExportToFile(fileData, args.surveyId, "csv", undefined, "filtered");

              return toolSuccess({
                status: "completed_via_fallback",
                originalError: errorMessage,
                format: "csv",
                appliedFilters: fallbackFilters,
                savedToFile: saved.filePath,
                fileSize: saved.fileSizeBytes,
                message: `Original filtered export failed, but CSV export with basic filters succeeded and was saved to: ${saved.filePath}`,
                metadata: { fallbackProgressId, fileId: progress.result.fileId },
              });
            }
            attempts++;
          }

          return toolSuccess({
            status: "fallback_timeout",
            originalError: errorMessage,
            progressId: fallbackProgressId,
            appliedFilters: fallbackFilters,
            message: "Both original filtered export and CSV fallback are taking longer than expected. Use check_export_status to monitor the CSV export progress.",
          });
        } catch (fallbackError) {
          const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          return {
            content: [{ type: "text" as const, text: `Error exporting filtered responses: ${errorMessage}. CSV fallback also failed: ${fallbackErrorMessage}. You may need to log into Qualtrics directly to export manually if the issue persists.` }],
            isError: true,
          };
        }
      }
    }
  );

  // Get single response
  server.tool(
    "get_response",
    "Get a single survey response by its response ID",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      responseId: z.string().min(1).describe("The response ID (e.g., R_123456789)"),
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
  server.tool(
    "create_response",
    "Import/create a response for a survey programmatically",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      values: z.record(z.any()).describe("Response values keyed by question ID (e.g., { 'QID1': 1, 'QID2': 'text answer' })"),
      embeddedData: z.record(z.any()).optional().describe("Embedded data fields to include with the response"),
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

  // Update response
  server.tool(
    "update_response",
    "Update an existing survey response",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      responseId: z.string().min(1).describe("The response ID to update"),
      values: z.record(z.any()).describe("Updated response values keyed by question ID"),
      embeddedData: z.record(z.any()).optional().describe("Updated embedded data fields"),
    },
    withErrorHandling("update_response", async (args) => {
      const data: Record<string, any> = { values: args.values };
      if (args.embeddedData) data.embeddedData = args.embeddedData;

      const result = await responseApi.updateResponse(args.surveyId, args.responseId, data);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        responseId: args.responseId,
        message: "Response updated successfully",
        details: result.result,
      });
    })
  );

  // Delete response
  server.tool(
    "delete_response",
    "Delete a survey response",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      responseId: z.string().min(1).describe("The response ID to delete"),
    },
    withErrorHandling("delete_response", async (args) => {
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
