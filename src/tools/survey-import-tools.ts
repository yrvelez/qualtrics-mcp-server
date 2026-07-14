import { Buffer } from "node:buffer";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import {
  SurveyImportApi,
  type SurveyImportFormat,
} from "../services/survey-import-api.js";
import { toolError, toolSuccess, withErrorHandling } from "./_helpers.js";

function surveyId(result: any): string | null {
  return result?.result?.id ?? result?.result?.SurveyID ?? null;
}

export function registerSurveyImportTools(
  server: McpServer,
  client: QualtricsClient
) {
  const importApi = new SurveyImportApi(client);

  server.registerTool(
    "copy_survey",
    {
      description:
        "Create a complete copy of an existing survey, preserving complex question types, scoring, flow, styling, and settings that do not have individual public mutation endpoints.",
      annotations: { destructiveHint: false },
      inputSchema: {
        sourceSurveyId: z.string().min(1).describe("Survey ID to copy"),
        name: z.string().min(1).describe("Name for the copied survey"),
        destinationOwnerId: z.string().min(1).optional().describe("Optional user ID in the same brand who should own the copy"),
      },
    },
    withErrorHandling("copy_survey", async (args) => {
      const result = await importApi.copySurvey(
        args.sourceSurveyId,
        args.name,
        args.destinationOwnerId
      );
      return toolSuccess({
        success: true,
        sourceSurveyId: args.sourceSurveyId,
        surveyId: surveyId(result),
        name: args.name,
        message: "Survey copy requested successfully; Qualtrics may take a short time to show it in the dashboard.",
        details: result?.result,
      });
    })
  );

  server.registerTool(
    "import_survey_qsf",
    {
      description:
        "Create a survey from a complete Qualtrics Survey Format (QSF) object using the official multipart import API. Use a QSF exported by the Qualtrics UI; the Survey Version API's format=qsf response is not the same import format.",
      annotations: { destructiveHint: false },
      inputSchema: {
        name: z.string().min(1).describe("Name for the imported survey"),
        qsf: z.record(z.any()).describe("Complete QSF JSON object exported by Qualtrics"),
        filename: z.string().min(1).optional().describe("Optional .qsf filename"),
      },
    },
    withErrorHandling("import_survey_qsf", async (args) => {
      const blob = new Blob([JSON.stringify(args.qsf)], {
        type: SurveyImportApi.mimeType("qsf"),
      });
      const result = await importApi.importContent(
        args.name,
        "qsf",
        blob,
        args.filename
      );
      return toolSuccess({
        success: true,
        surveyId: surveyId(result),
        name: args.name,
        message: "QSF survey import requested successfully; dashboard appearance may be delayed.",
        details: result?.result,
      });
    })
  );

  server.registerTool(
    "import_survey_text",
    {
      description:
        "Create a survey from Qualtrics Simple or Advanced TXT format. Supports question IDs/tags, blocks, page breaks, embedded data, choice randomization, MC, Matrix, TE, Constant Sum, Rank Order, and descriptive text syntax.",
      annotations: { destructiveHint: false },
      inputSchema: {
        name: z.string().min(1).describe("Name for the imported survey"),
        text: z.string().min(1).describe("Complete Qualtrics Simple or Advanced TXT survey definition"),
        filename: z.string().min(1).optional().describe("Optional .txt filename"),
      },
    },
    withErrorHandling("import_survey_text", async (args) => {
      const blob = new Blob([args.text], { type: SurveyImportApi.mimeType("txt") });
      const result = await importApi.importContent(
        args.name,
        "txt",
        blob,
        args.filename
      );
      return toolSuccess({
        success: true,
        surveyId: surveyId(result),
        name: args.name,
        message: "Text survey import requested successfully; dashboard appearance may be delayed.",
        details: result?.result,
      });
    })
  );

  server.registerTool(
    "import_survey_from_url",
    {
      description:
        "Create a survey from a publicly accessible QSF, TXT, or DOCX URL. Qualtrics fetches the file, so private/local URLs will not work.",
      annotations: { destructiveHint: false },
      inputSchema: {
        name: z.string().min(1).describe("Name for the imported survey"),
        format: z.enum(["qsf", "txt", "docx"]).describe("File format"),
        fileUrl: z.string().url().describe("Public HTTPS URL of the import file"),
      },
    },
    withErrorHandling("import_survey_from_url", async (args) => {
      const url = new URL(args.fileUrl);
      if (url.protocol !== "https:") {
        return toolError("fileUrl must use HTTPS.");
      }
      const result = await importApi.importFromUrl(
        args.name,
        args.format as SurveyImportFormat,
        args.fileUrl
      );
      return toolSuccess({
        success: true,
        surveyId: surveyId(result),
        name: args.name,
        sourceUrl: args.fileUrl,
        message: "Survey URL import requested successfully; dashboard appearance may be delayed.",
        details: result?.result,
      });
    })
  );

  server.registerTool(
    "import_survey_docx",
    {
      description:
        "Create a survey from a base64-encoded DOCX prepared in Qualtrics Simple/Advanced import format. Prefer import_survey_text when possible because it is transparent and easier to validate.",
      annotations: { destructiveHint: false },
      inputSchema: {
        name: z.string().min(1).describe("Name for the imported survey"),
        contentBase64: z.string().min(1).describe("Base64-encoded DOCX bytes"),
        filename: z.string().min(1).optional().describe("Optional .docx filename"),
      },
    },
    withErrorHandling("import_survey_docx", async (args) => {
      const bytes = Buffer.from(args.contentBase64, "base64");
      if (bytes.length === 0) return toolError("contentBase64 decoded to an empty file.");
      if (bytes.length > 25 * 1024 * 1024) {
        return toolError("DOCX content exceeds the MCP tool's 25 MB safety limit; use import_survey_from_url instead.");
      }
      // DOCX/ZIP files start with the PK signature.
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        return toolError("contentBase64 does not appear to be a valid DOCX/ZIP file.");
      }

      const blob = new Blob([bytes], { type: SurveyImportApi.mimeType("docx") });
      const result = await importApi.importContent(
        args.name,
        "docx",
        blob,
        args.filename
      );
      return toolSuccess({
        success: true,
        surveyId: surveyId(result),
        name: args.name,
        message: "DOCX survey import requested successfully; dashboard appearance may be delayed.",
        details: result?.result,
      });
    })
  );
}
