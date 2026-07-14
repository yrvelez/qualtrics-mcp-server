import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import {
  SurveyDesignApi,
  type SurveyVersionFormat,
} from "../services/survey-design-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolError, toolSuccess, withErrorHandling } from "./_helpers.js";

type JsonRecord = Record<string, any>;

const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge JSON objects recursively while treating arrays and null as replacement
 * values. This preserves nested option objects such as Skin.overrides when a
 * caller updates only one nested field.
 */
function mergeRecords(current: JsonRecord, patch: JsonRecord): JsonRecord {
  const merged: JsonRecord = {};

  for (const [key, value] of Object.entries(current)) {
    if (!UNSAFE_OBJECT_KEYS.has(key)) merged[key] = value;
  }

  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) continue;
    const existing = merged[key];
    merged[key] = isRecord(existing) && isRecord(value)
      ? mergeRecords(existing, value)
      : value;
  }

  return merged;
}

function resultRecord(response: any, operation: string): JsonRecord {
  if (!isRecord(response?.result)) {
    throw new Error(
      `Qualtrics returned an unexpected ${operation} response without an object result`
    );
  }
  return response.result;
}

function setIfDefined(
  target: JsonRecord,
  key: string,
  value: unknown
): void {
  if (value !== undefined) target[key] = value;
}

export function registerSurveyDesignTools(
  server: McpServer,
  client: QualtricsClient,
  _config: QualtricsConfig
) {
  const surveyDesignApi = new SurveyDesignApi(client);

  server.registerTool(
    "get_survey_metadata",
    {
      description:
        "Get survey-definition metadata, including ownership, status, language, and lifecycle dates",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("get_survey_metadata", async (args) => {
      const result = await surveyDesignApi.getSurveyMetadata(args.surveyId);
      return toolSuccess({
        surveyId: args.surveyId,
        metadata: result.result,
        meta: result.meta,
      });
    })
  );

  server.registerTool(
    "update_survey_metadata",
    {
      description:
        "Update survey-definition metadata. Common fields are exposed directly; metadata accepts any additional Qualtrics metadata fields. Date fields must use MySQL datetime format (YYYY-MM-DD HH:mm:ss), not ISO-8601.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        name: z.string().min(1).optional().describe("New SurveyName"),
        description: z.string().optional().describe("New SurveyDescription"),
        status: z.string().optional().describe("New SurveyStatus value"),
        startDate: z.string().optional().describe("SurveyStartDate in YYYY-MM-DD HH:mm:ss format"),
        expirationDate: z.string().optional().describe("SurveyExpirationDate in YYYY-MM-DD HH:mm:ss format"),
        metadata: z.record(z.any()).optional().describe("Raw Qualtrics metadata fields; explicit common arguments override matching keys"),
      },
    },
    withErrorHandling("update_survey_metadata", async (args) => {
      const data: JsonRecord = { ...(args.metadata ?? {}) };
      setIfDefined(data, "SurveyName", args.name);
      setIfDefined(data, "SurveyDescription", args.description);
      setIfDefined(data, "SurveyStatus", args.status);
      setIfDefined(data, "SurveyStartDate", args.startDate);
      setIfDefined(data, "SurveyExpirationDate", args.expirationDate);

      if (Object.keys(data).length === 0) {
        return toolError(
          "No metadata changes supplied. Provide a common field or the metadata record."
        );
      }

      const result = await surveyDesignApi.updateSurveyMetadata(
        args.surveyId,
        data
      );
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        message: "Survey metadata updated successfully",
        submittedMetadata: data,
        details: result.result,
        meta: result.meta,
      });
    })
  );

  server.registerTool(
    "get_survey_options",
    {
      description:
        "Get the complete survey options object, including navigation, protection, partial-response, language, theme, CSS, and termination settings",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("get_survey_options", async (args) => {
      const result = await surveyDesignApi.getSurveyOptions(args.surveyId);
      return toolSuccess({
        surveyId: args.surveyId,
        options: result.result,
        meta: result.meta,
      });
    })
  );

  server.registerTool(
    "update_survey_options",
    {
      description:
        "Safely patch survey options. By default the current options are fetched and recursively merged before PUT so omitted settings are preserved. Set replace=true only to submit exactly the supplied options and intentionally reset or remove omitted settings.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        options: z.record(z.any()).optional().describe("Raw Qualtrics options patch; supports every current or future option field"),
        replace: z.boolean().optional().describe("Submit only supplied fields instead of safely merging with current options (default: false)"),
        backButton: z.boolean().optional().describe("Enable or disable the BackButton option"),
        ballotBoxStuffingPrevention: z.boolean().optional().describe("Enable or disable ballot-box-stuffing prevention"),
        header: z.string().optional().describe("Survey header HTML"),
        footer: z.string().optional().describe("Survey footer HTML"),
        nextButton: z.string().optional().describe("Next-button label"),
        previousButton: z.string().optional().describe("Previous-button label"),
        noIndex: z.string().optional().describe("Search-index setting, commonly Yes or No"),
        partialData: z.string().optional().describe("Partial-response retention setting, such as +1 week"),
        progressBarDisplay: z.string().optional().describe("Progress-bar display mode, such as None, Text, or Verbose"),
        saveAndContinue: z.boolean().optional().describe("Enable or disable Save and Continue"),
        skin: z.record(z.any()).optional().describe("Skin object, including brandingId, templateId, and overrides"),
        surveyProtection: z.string().optional().describe("Survey protection mode, such as PublicSurvey or ByInvitation"),
        surveyTermination: z.string().optional().describe("Survey termination mode"),
        anonymizeResponse: z.string().optional().describe("AnonymizeResponse option, commonly Yes or No"),
        questionsPerPage: z.union([z.string(), z.number()]).optional().describe("QuestionsPerPage option in the form accepted by the brand"),
        pageTransition: z.string().optional().describe("Page transition mode"),
        customStyles: z.string().optional().describe("Custom survey CSS stored in CustomStyles"),
        externalCss: z.string().optional().describe("ExternalCSS value"),
        surveyLanguage: z.string().optional().describe("Primary SurveyLanguage code"),
        availableLanguages: z.record(z.any()).optional().describe("AvailableLanguages options object"),
        endOfSurveyMessage: z.string().optional().describe("EOSMessage HTML/text"),
        endOfSurveyRedirectUrl: z.string().optional().describe("EOSRedirectURL"),
      },
    },
    withErrorHandling("update_survey_options", async (args) => {
      let patch: JsonRecord = { ...(args.options ?? {}) };
      setIfDefined(patch, "BackButton", args.backButton);
      setIfDefined(
        patch,
        "BallotBoxStuffingPrevention",
        args.ballotBoxStuffingPrevention
      );
      setIfDefined(patch, "Header", args.header);
      setIfDefined(patch, "Footer", args.footer);
      setIfDefined(patch, "NextButton", args.nextButton);
      setIfDefined(patch, "PreviousButton", args.previousButton);
      setIfDefined(patch, "NoIndex", args.noIndex);
      setIfDefined(patch, "PartialData", args.partialData);
      setIfDefined(patch, "ProgressBarDisplay", args.progressBarDisplay);
      setIfDefined(patch, "SaveAndContinue", args.saveAndContinue);
      setIfDefined(patch, "SurveyProtection", args.surveyProtection);
      setIfDefined(patch, "SurveyTermination", args.surveyTermination);
      setIfDefined(patch, "AnonymizeResponse", args.anonymizeResponse);
      setIfDefined(patch, "QuestionsPerPage", args.questionsPerPage);
      setIfDefined(patch, "PageTransition", args.pageTransition);
      setIfDefined(patch, "CustomStyles", args.customStyles);
      setIfDefined(patch, "ExternalCSS", args.externalCss);
      setIfDefined(patch, "SurveyLanguage", args.surveyLanguage);
      setIfDefined(patch, "EOSMessage", args.endOfSurveyMessage);
      setIfDefined(patch, "EOSRedirectURL", args.endOfSurveyRedirectUrl);

      if (args.skin !== undefined) {
        const rawSkin = isRecord(patch.Skin) ? patch.Skin : {};
        patch.Skin = mergeRecords(rawSkin, args.skin);
      }
      if (args.availableLanguages !== undefined) {
        const rawLanguages = isRecord(patch.AvailableLanguages)
          ? patch.AvailableLanguages
          : {};
        patch.AvailableLanguages = mergeRecords(
          rawLanguages,
          args.availableLanguages
        );
      }

      if (Object.keys(patch).length === 0) {
        return toolError(
          "No option changes supplied. Provide a common option or the options record."
        );
      }

      const replace = args.replace ?? false;
      if (!replace) {
        const current = await surveyDesignApi.getSurveyOptions(args.surveyId);
        patch = mergeRecords(resultRecord(current, "get survey options"), patch);
      }

      const result = await surveyDesignApi.updateSurveyOptions(
        args.surveyId,
        patch
      );
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        updateMode: replace ? "replace" : "safe-merge",
        message: "Survey options updated successfully",
        submittedOptions: patch,
        details: result.result,
        meta: result.meta,
      });
    })
  );

  server.registerTool(
    "list_survey_versions",
    {
      description: "List saved versions of a survey definition",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("list_survey_versions", async (args) => {
      const result = await surveyDesignApi.listSurveyVersions(args.surveyId);
      return toolSuccess({
        surveyId: args.surveyId,
        versions: result.result,
        meta: result.meta,
      });
    })
  );

  server.registerTool(
    "get_survey_version",
    {
      description:
        "Get a saved survey version in JSON or QSF format. A version-export QSF is not guaranteed to be accepted unchanged by the separate survey-import API.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        versionId: z.string().min(1).describe("The survey version ID"),
        format: z.enum(["json", "qsf"]).optional().describe("Version format (default: json)"),
      },
    },
    withErrorHandling("get_survey_version", async (args) => {
      const format = (args.format ?? "json") as SurveyVersionFormat;
      const result = await surveyDesignApi.getSurveyVersion(
        args.surveyId,
        args.versionId,
        format
      );
      return toolSuccess({
        surveyId: args.surveyId,
        versionId: args.versionId,
        format,
        version: result.result,
        meta: result.meta,
      });
    })
  );

  server.registerTool(
    "create_survey_version",
    {
      description:
        "Create a survey version. Versions are drafts by default; published=true creates and immediately publishes the version. Additional version fields can be supplied through version.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        description: z.string().min(1).optional().describe("Human-readable version description"),
        published: z.boolean().optional().describe("Publish this version immediately (default: false)"),
        version: z.record(z.any()).optional().describe("Raw Qualtrics create-version payload; explicit arguments override matching keys"),
      },
    },
    withErrorHandling("create_survey_version", async (args) => {
      const data: JsonRecord = { ...(args.version ?? {}) };
      setIfDefined(data, "Description", args.description);
      if (args.published !== undefined) {
        data.Published = args.published;
      } else if (data.Published === undefined) {
        data.Published = false;
      }

      if (
        typeof data.Description !== "string" ||
        data.Description.trim().length === 0
      ) {
        return toolError(
          "A non-empty version description is required, either as description or version.Description."
        );
      }

      const result = await surveyDesignApi.createSurveyVersion(
        args.surveyId,
        data
      );
      const versionId =
        result.result?.metadata?.versionID ??
        result.result?.metadata?.VersionID ??
        result.result?.VersionID ??
        result.result?.VersionId ??
        result.result?.versionId ??
        result.result?.id;
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        versionId,
        published: data.Published,
        message: data.Published
          ? "Survey version created and published successfully"
          : "Draft survey version created successfully",
        details: result.result,
        meta: result.meta,
      });
    })
  );

  server.registerTool(
    "get_survey_languages",
    {
      description: "Get the language codes currently enabled for a survey",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("get_survey_languages", async (args) => {
      const result = await surveyDesignApi.getSurveyLanguages(args.surveyId);
      return toolSuccess({
        surveyId: args.surveyId,
        availableLanguages:
          result.result?.AvailableLanguages ?? result.result,
        details: result.result,
        meta: result.meta,
      });
    })
  );

  server.registerTool(
    "update_survey_languages",
    {
      description:
        "Update the survey's AvailableLanguages option map through the documented survey-options PUT. The complete current options resource is fetched and preserved. By default language-map keys are merged; set replace=true to replace the complete AvailableLanguages map. Requires Translate Surveys permission.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        availableLanguages: z.record(z.any()).describe("AvailableLanguages option-map patch keyed by language code, or the complete map when replace=true"),
        replace: z.boolean().optional().describe("Replace rather than merge the AvailableLanguages map (default: false)"),
      },
    },
    withErrorHandling("update_survey_languages", async (args) => {
      const current = await surveyDesignApi.getSurveyOptions(args.surveyId);
      const options = resultRecord(current, "get survey options");
      const replace = args.replace ?? false;
      const existing = isRecord(options.AvailableLanguages)
        ? options.AvailableLanguages
        : {};
      options.AvailableLanguages = replace
        ? { ...args.availableLanguages }
        : mergeRecords(existing, args.availableLanguages);

      const result = await surveyDesignApi.updateSurveyOptions(
        args.surveyId,
        options
      );
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        updateMode: replace ? "replace-language-map" : "safe-merge-language-map",
        availableLanguages: options.AvailableLanguages,
        message: "Survey languages updated successfully",
        details: result.result,
        meta: result.meta,
      });
    })
  );

  server.registerTool(
    "get_survey_translations",
    {
      description:
        "Get the complete translation map for one enabled survey language",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        languageCode: z.string().min(1).describe("Translation language code, such as ES or FR"),
      },
    },
    withErrorHandling("get_survey_translations", async (args) => {
      const result = await surveyDesignApi.getSurveyTranslations(
        args.surveyId,
        args.languageCode
      );
      return toolSuccess({
        surveyId: args.surveyId,
        languageCode: args.languageCode,
        translations: result.result,
        meta: result.meta,
      });
    })
  );

  server.registerTool(
    "update_survey_translations",
    {
      description:
        "Update translations for one language. By default the current map is fetched and the supplied keys are merged so Qualtrics receives the required complete map. Set replace=true only when translations already contains the complete map and omitted keys should be removed. Requires Translate Surveys permission.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        languageCode: z.string().min(1).describe("Translation language code, such as ES or FR"),
        translations: z.record(z.string()).describe("Translation key-to-text patch, or the complete map when replace=true"),
        replace: z.boolean().optional().describe("Submit exactly translations instead of merging with the current map (default: false)"),
      },
    },
    withErrorHandling("update_survey_translations", async (args) => {
      const replace = args.replace ?? false;
      let translations: JsonRecord = { ...args.translations };

      if (!replace) {
        const current = await surveyDesignApi.getSurveyTranslations(
          args.surveyId,
          args.languageCode
        );
        translations = mergeRecords(
          resultRecord(current, "get survey translations"),
          translations
        );
      }

      const result = await surveyDesignApi.updateSurveyTranslations(
        args.surveyId,
        args.languageCode,
        translations
      );
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        languageCode: args.languageCode,
        updateMode: replace ? "replace" : "safe-merge",
        message: "Survey translations updated successfully",
        submittedTranslationCount: Object.keys(translations).length,
        details: result.result,
        meta: result.meta,
      });
    })
  );
}
