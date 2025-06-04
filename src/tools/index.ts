import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { QualtricsConfig } from "../config/settings.js";

const ListSurveysSchema = z.object({
  offset: z.number().optional().default(0),
  limit: z.number().max(100).optional().default(20),
  filter: z.string().optional(),
});

const GetSurveySchema = z.object({
  surveyId: z.string().min(1, "Survey ID is required"),
  includeDefinition: z.boolean().optional().default(false),
});

const CreateSurveySchema = z.object({
  name: z.string().min(1, "Survey name is required"),
  language: z.string().optional().default("EN"),
  projectCategory: z.string().optional().default("CORE"),
});

const ExportResponsesSchema = z.object({
  surveyId: z.string().min(1, "Survey ID is required"),
  format: z.enum(["json", "csv"]).optional().default("json"),
  waitForCompletion: z.boolean().optional().default(true),
});

const CheckExportStatusSchema = z.object({
  surveyId: z.string().min(1, "Survey ID is required"),
  exportProgressId: z.string().min(1, "Export progress ID is required"),
});

export async function registerTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  // List surveys tool
  server.tool(
    "list_surveys",
    "List surveys with optional filtering and pagination",
    {
      offset: z.number().optional().describe("Starting offset for pagination (default: 0)"),
      limit: z.number().max(100).optional().describe("Maximum number of surveys to return (max: 100, default: 20)"),
      filter: z.string().optional().describe("Filter surveys by name (case-insensitive partial match)"),
    },
    async (args) => {
      try {
        const surveys = await client.getSurveys(args.offset ?? 0, args.limit ?? 20);

        let filteredSurveys = surveys.result.elements;
        if (args.filter) {
          const filterLower = args.filter.toLowerCase();
          filteredSurveys = filteredSurveys.filter(survey =>
            survey.name.toLowerCase().includes(filterLower)
          );
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
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
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error listing surveys: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Get survey tool
  server.tool(
    "get_survey",
    "Get detailed information about a specific survey",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID (e.g., SV_123456789)"),
      includeDefinition: z.boolean().optional().describe("Include full survey definition with questions and logic (default: false)"),
    },
    async (args) => {
      try {
        const [surveyInfo, surveyDefinition] = await Promise.all([
          client.getSurvey(args.surveyId),
          args.includeDefinition ? client.getSurveyDefinition(args.surveyId) : null,
        ]);

        const result = {
          survey: surveyInfo.result,
          definition: surveyDefinition?.result || null,
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error getting survey: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
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
    async (args) => {
      try {
        const surveyData = {
          SurveyName: args.name,
          Language: args.language ?? "EN",
          ProjectCategory: args.projectCategory ?? "CORE",
        };

        const result = await client.createSurvey(surveyData);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              surveyId: result.result.SurveyID,
              message: `Survey "${args.name}" created successfully`,
              details: result.result,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error creating survey: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Export responses tool
  server.tool(
    "export_responses",
    "Export survey responses in JSON or CSV format. WARNING: Large surveys may produce very large files that are difficult to analyze. Consider using 'export_responses_filtered' instead to reduce file size with date ranges, specific questions, or completion status filters.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      format: z.enum(["json", "csv"]).optional().describe("Export format (default: json)"),
      waitForCompletion: z.boolean().optional().describe("Wait for export to complete before returning (default: true)"),
      saveToFile: z.string().optional().describe("Save export to local file path instead of returning data directly (recommended for large exports to avoid context limits)"),
    },
    async (args) => {
      try {
        // Start the export
        const exportJob = await client.startResponseExport(args.surveyId, args.format ?? "json");
        const progressId = exportJob.result.progressId;

        if (!args.waitForCompletion) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "started",
                progressId: progressId,
                message: "Export started. Use check_export_status to monitor progress.",
              }, null, 2),
            }],
          };
        }

        // Wait for completion
        let attempts = 0;
        const maxAttempts = 30; // 5 minutes max wait time
        
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
          
          const progress = await client.getResponseExportProgress(args.surveyId, progressId);
          
          if (progress.result.percentComplete === 100) {
            // Download the file
            const fileData = await client.downloadResponseExportFile(
              args.surveyId, 
              progress.result.fileId
            );

            if (args.saveToFile) {
              // Save to local file
              const fs = await import('fs/promises');
              const path = await import('path');
              const os = await import('os');
              
              // If relative path, save to home directory
              const filePath = path.isAbsolute(args.saveToFile) 
                ? args.saveToFile 
                : path.join(os.homedir(), args.saveToFile);
              
              await fs.writeFile(filePath, fileData, 'utf8');
              
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    status: "completed",
                    format: args.format,
                    savedToFile: filePath,
                    fileSize: fileData.length,
                    message: `Export saved to ${filePath}`,
                    metadata: {
                      progressId: progressId,
                      fileId: progress.result.fileId,
                    },
                  }, null, 2),
                }],
              };
            } else {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    status: "completed",
                    format: args.format,
                    data: args.format === "json" ? JSON.parse(fileData) : fileData,
                    metadata: {
                      progressId: progressId,
                      fileId: progress.result.fileId,
                    },
                  }, null, 2),
                }],
              };
            }
          }

          attempts++;
        }

        // Timeout reached
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "timeout",
              progressId: progressId,
              message: "Export is taking longer than expected. Use check_export_status to monitor.",
            }, null, 2),
          }],
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const helpText = errorMessage.toLowerCase().includes('timeout') || errorMessage.toLowerCase().includes('too large') 
          ? " TIP: Try using 'export_responses_filtered' with date ranges, specific questions, or completion filters to reduce file size."
          : "";
        
        return {
          content: [{
            type: "text",
            text: `Error exporting responses: ${errorMessage}${helpText}`,
          }],
          isError: true,
        };
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
    async (args) => {
      try {
        const progress = await client.getResponseExportProgress(
          args.surveyId, 
          args.exportProgressId
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              progressId: args.exportProgressId,
              percentComplete: progress.result.percentComplete,
              status: progress.result.status,
              isComplete: progress.result.percentComplete === 100,
              fileId: progress.result.fileId || null,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error checking export status: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Filtered export responses tool
  server.tool(
    "export_responses_filtered",
    "Export survey responses with filters to reduce data size. RECOMMENDED for large surveys or when analyzing specific subsets. Use date filters, question selection, or completion status to create manageable datasets for analysis.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      format: z.enum(["json", "csv"]).optional().describe("Export format (default: json)"),
      waitForCompletion: z.boolean().optional().describe("Wait for export to complete before returning (default: true)"),
      saveToFile: z.string().optional().describe("Save export to local file path instead of returning data directly (recommended for large exports to avoid context limits)"),
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
        // Build filters object
        const filters: any = {};
        
        if (args.startDate) {
          filters.startDate = args.startDate;
        }
        
        if (args.endDate) {
          filters.endDate = args.endDate;
        }
        
        if (args.filterType && args.filterType !== "all") {
          filters.filterType = args.filterType === "complete" ? "finished" : "unfinished";
        }
        
        if (args.includeDisplayOrder !== undefined) {
          filters.includeDisplayOrder = args.includeDisplayOrder;
        }
        
        if (args.useLabels !== undefined) {
          filters.useLabels = args.useLabels;
        }
        
        if (args.questionIds && args.questionIds.length > 0) {
          filters.questionIds = args.questionIds;
        }
        
        if (args.embeddedDataIds && args.embeddedDataIds.length > 0) {
          filters.embeddedDataIds = args.embeddedDataIds;
        }

        // Start the filtered export
        const exportJob = await client.startResponseExport(
          args.surveyId, 
          args.format ?? "json", 
          Object.keys(filters).length > 0 ? filters : undefined
        );
        const progressId = exportJob.result.progressId;

        if (!args.waitForCompletion) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "started",
                progressId: progressId,
                filters: filters,
                message: "Filtered export started. Use check_export_status to monitor progress.",
              }, null, 2),
            }],
          };
        }

        // Wait for completion
        let attempts = 0;
        const maxAttempts = 30; // 5 minutes max wait time
        
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
          
          const progress = await client.getResponseExportProgress(args.surveyId, progressId);
          
          if (progress.result.percentComplete === 100) {
            // Download the file
            const fileData = await client.downloadResponseExportFile(
              args.surveyId, 
              progress.result.fileId
            );

            if (args.saveToFile) {
              // Save to local file
              const fs = await import('fs/promises');
              const path = await import('path');
              const os = await import('os');
              
              // If relative path, save to home directory
              const filePath = path.isAbsolute(args.saveToFile) 
                ? args.saveToFile 
                : path.join(os.homedir(), args.saveToFile);
              
              await fs.writeFile(filePath, fileData, 'utf8');
              
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    status: "completed",
                    format: args.format,
                    filters: filters,
                    savedToFile: filePath,
                    fileSize: fileData.length,
                    message: `Filtered export saved to ${filePath}`,
                    metadata: {
                      progressId: progressId,
                      fileId: progress.result.fileId,
                    },
                  }, null, 2),
                }],
              };
            } else {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    status: "completed",
                    format: args.format,
                    filters: filters,
                    data: args.format === "json" ? JSON.parse(fileData) : fileData,
                    metadata: {
                      progressId: progressId,
                      fileId: progress.result.fileId,
                    },
                  }, null, 2),
                }],
              };
            }
          }

          attempts++;
        }

        // Timeout reached
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "timeout",
              progressId: progressId,
              filters: filters,
              message: "Export is taking longer than expected. Use check_export_status to monitor.",
            }, null, 2),
          }],
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error exporting filtered responses: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );
}