import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { SurveyApi } from "../services/survey-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolError, toolSuccess, withErrorHandling, requireDeleteConfirmation } from "./_helpers.js";

const reservedExportTags = new Map<string, Set<string>>();

async function nextExportTag(
  surveyApi: SurveyApi,
  surveyId: string,
  questionText?: string
): Promise<string> {
  const stem = (questionText ?? "Question")
    .replace(/<[^>]*>/g, " ")
    .replace(/\$\{[^}]+\}/g, " embedded data ")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  const base = /^[A-Za-z]/.test(stem)
    ? stem
    : `Question_${stem || "Response"}`;

  const result = await surveyApi.listQuestions(surveyId);
  const rawQuestions = result?.result?.elements ?? result?.result ?? [];
  const questions = Array.isArray(rawQuestions)
    ? rawQuestions
    : Object.values(rawQuestions);
  const used = new Set<string>();
  for (const question of questions as Array<Record<string, any>>) {
    if (typeof question?.DataExportTag === "string") {
      used.add(question.DataExportTag);
    }
  }
  const reserved = reservedExportTags.get(surveyId) ?? new Set<string>();
  reservedExportTags.set(surveyId, reserved);
  for (const tag of reserved) used.add(tag);

  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  reserved.add(candidate);
  return candidate;
}

const QUESTION_JS_DESC =
  "JavaScript to attach to this question (QuestionJS). IMPORTANT: Avoid literal `${` in JS strings — Qualtrics interprets it as piped text and corrupts the code. Use `\\x24{` or `String.fromCharCode(36)+'{'` instead.";

const PIPED_TEXT_PREFIXES = /^\$\{(?:q|e|m|date|rand|lm|gr):\/\//i;

function checkQuestionJSWarning(js: string): string | null {
  // Find ${ sequences that are NOT valid Qualtrics piped text
  const dollarBracePattern = /\$\{/g;
  let match;
  let hasUnsafeDollarBrace = false;
  while ((match = dollarBracePattern.exec(js)) !== null) {
    const substring = js.slice(match.index);
    if (!PIPED_TEXT_PREFIXES.test(substring)) {
      hasUnsafeDollarBrace = true;
      break;
    }
  }
  if (hasUnsafeDollarBrace) {
    return "WARNING: Your QuestionJS contains literal `${` which Qualtrics will interpret as piped text, corrupting your JavaScript at runtime. Replace `${` in string literals with `\\x24{` or `String.fromCharCode(36)+'{'`.";
  }
  return null;
}

// QuestionDescription is required by the API schema (max 100 chars, plain text).
function toQuestionDescription(text: string): string {
  const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return plain.substring(0, 100) || "Question";
}

function buildDisplayMap(labels: string[]): Record<string, { Display: string }> {
  const map: Record<string, { Display: string }> = {};
  labels.forEach((label, index) => {
    map[String(index + 1)] = { Display: label };
  });
  return map;
}

function orderKeys(count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(i + 1));
}

function validationSettings(forceResponse: boolean | undefined): Record<string, any> {
  return {
    Settings: {
      ForceResponse: forceResponse ? "ON" : "OFF",
      ForceResponseType: "ON",
      Type: "None",
    },
  };
}

async function attachQuestionJs(
  surveyApi: SurveyApi,
  surveyId: string,
  questionId: string,
  questionJs: string
): Promise<void> {
  // QuestionJS is reliably supported on the full question PUT, but is not in
  // the public create-question schema. Carry the newly created definition
  // forward so attaching JavaScript cannot erase other question fields.
  const current = await surveyApi.getQuestion(surveyId, questionId);
  const definition: Record<string, any> = {
    ...current.result,
    QuestionJS: questionJs,
  };
  delete definition.QuestionID;
  delete definition.QuestionText_Unsafe;
  await surveyApi.updateQuestion(surveyId, questionId, definition);
}

// Valid SubSelector values per Matrix Selector (mismatches cause opaque 400s).
const MATRIX_SUBSELECTORS: Record<string, string[]> = {
  Likert: ["SingleAnswer", "MultipleAnswer", "DL"],
  Bipolar: ["SingleAnswer"],
  RO: ["DND", "TX"],
  TE: ["Short", "Medium", "Long", "Essay"],
  CS: ["WOTB", "WTB"],
  Profile: ["SingleAnswer", "MultipleAnswer", "DL"],
  MaxDiff: ["SingleAnswer"],
};

export function registerQuestionTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const surveyApi = new SurveyApi(client);

  // List questions
  server.registerTool(
    "list_questions",
    {
      description: "List all questions in a survey with their types and a preview of the question text",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("list_questions", async (args) => {
      const result = await surveyApi.listQuestions(args.surveyId);
      const questions = result.result.elements || result.result;

      const questionList = Array.isArray(questions)
        ? questions
        : Object.values(questions);

      return toolSuccess({
        surveyId: args.surveyId,
        questions: (questionList as any[]).map((q: any) => ({
          questionId: q.QuestionID,
          questionText: q.QuestionText?.substring(0, 100),
          questionType: q.QuestionType,
          selector: q.Selector,
          choiceCount: q.Choices ? Object.keys(q.Choices).length : 0,
        })),
        total: (questionList as any[]).length,
      });
    })
  );

  // Get question
  server.registerTool(
    "get_question",
    {
      description: "Get the full definition of a specific question including choices, validation, and configuration",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        questionId: z.string().min(1).describe("The question ID (e.g., QID1)"),
      },
    },
    withErrorHandling("get_question", async (args) => {
      const result = await surveyApi.getQuestion(args.surveyId, args.questionId);
      return toolSuccess({
        surveyId: args.surveyId,
        question: result.result,
      });
    })
  );

  // Create question (raw)
  server.registerTool(
    "create_question",
    {
      description:
        "Create a question in a survey block with full payload control. For Matrix questions: Choices = rows/statements, Answers = columns/scale points (both required). Use additionalFields to pass any other Qualtrics question-definition fields (e.g., a template from get_question_template). For common types, prefer the add_*_question helpers.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        blockId: z.string().min(1).describe("The block ID to add the question to"),
        questionText: z.string().min(1).describe("The question text (HTML supported)"),
        questionType: z.string().min(1).describe("Qualtrics question type (e.g., MC, TE, Matrix, Slider, RO, CS, DB)"),
        selector: z.string().min(1).describe("Question selector (e.g., SAVR, MAVR, SL, ML, Likert, TB)"),
        subSelector: z.string().optional().describe("Sub-selector if applicable (e.g., TX, SingleAnswer)"),
        choices: z.record(z.object({
          Display: z.string(),
        }).passthrough()).optional().describe("Choice definitions keyed by choice number (rows/statements for Matrix)"),
        choiceOrder: z.array(z.string()).optional().describe("Display order of choice keys (derived from choices if omitted)"),
        answers: z.record(z.object({
          Display: z.string(),
        }).passthrough()).optional().describe("Answer definitions keyed by answer number (columns/scale points — required for Matrix)"),
        answerOrder: z.array(z.string()).optional().describe("Display order of answer keys (derived from answers if omitted)"),
        validation: z.record(z.any()).optional().describe("Validation settings"),
        configuration: z.record(z.any()).optional().describe("Configuration object (e.g., {QuestionDescriptionOption: 'UseText', TextPosition: 'inline'})"),
        dataExportTag: z.string().trim().min(1).optional().describe("Custom export tag (recommended; a readable unique tag derived from questionText is generated if omitted)"),
        questionDescription: z.string().optional().describe("Internal label shown in the editor (derived from questionText if omitted)"),
        recodeValues: z.record(z.string()).optional().describe("Numeric recode mapping keyed by choice/answer id"),
        questionJS: z.string().optional().describe(QUESTION_JS_DESC),
        additionalFields: z.record(z.any()).optional().describe("Any other question-definition fields, applied before the explicit fields above (e.g., SBS AdditionalQuestions, slider configs, a get_question_template result)"),
      },
    },
    withErrorHandling("create_question", async (args) => {
      const questionData: Record<string, any> = {
        ...(args.additionalFields ?? {}),
        QuestionText: args.questionText,
        QuestionType: args.questionType,
        Selector: args.selector,
        DataExportTag: args.dataExportTag ?? await nextExportTag(surveyApi, args.surveyId, args.questionText),
      };
      if (args.subSelector) questionData.SubSelector = args.subSelector;
      if (args.choices) {
        questionData.Choices = args.choices;
        questionData.ChoiceOrder = args.choiceOrder ?? Object.keys(args.choices);
      }
      if (args.answers) {
        questionData.Answers = args.answers;
        questionData.AnswerOrder = args.answerOrder ?? Object.keys(args.answers);
      }
      if (args.validation) questionData.Validation = args.validation;
      if (args.configuration) questionData.Configuration = args.configuration;
      if (args.questionDescription) questionData.QuestionDescription = args.questionDescription;
      if (args.recodeValues) questionData.RecodeValues = args.recodeValues;
      if (args.questionJS !== undefined) questionData.QuestionJS = args.questionJS;

      // The Matrix schema requires these fields; fill defaults so callers don't hit
      // Qualtrics's opaque anyOf 400 for omitting boilerplate.
      if (args.questionType === "Matrix") {
        questionData.QuestionDescription ??= toQuestionDescription(args.questionText);
        questionData.Configuration ??= { QuestionDescriptionOption: "UseText" };
        questionData.Validation ??= validationSettings(false);
        questionData.ChoiceDataExportTags ??= false;
        questionData.DefaultChoices ??= false;
        questionData.Language ??= [];
        if (!questionData.Choices) {
          return toolError("Matrix questions require 'choices' (the rows/statements). Provide choices, or use add_matrix_question.");
        }
        if (!questionData.Answers) {
          return toolError("Matrix questions require 'answers' (the columns/scale points). Provide answers, or use add_matrix_question.");
        }
      }

      // Never forward identifiers/read-only renderings from copied definitions.
      delete questionData.QuestionID;
      delete questionData.QuestionText_Unsafe;

      const questionJs = typeof questionData.QuestionJS === "string"
        ? questionData.QuestionJS
        : undefined;
      delete questionData.QuestionJS;

      const result = await surveyApi.createQuestion(args.surveyId, args.blockId, questionData);
      if (questionJs !== undefined) {
        await attachQuestionJs(
          surveyApi,
          args.surveyId,
          result.result.QuestionID,
          questionJs
        );
      }

      const response: Record<string, any> = {
        success: true,
        surveyId: args.surveyId,
        blockId: args.blockId,
        questionId: result.result.QuestionID,
        message: "Question created successfully",
        details: result.result,
      };

      if (args.questionJS) {
        const warning = checkQuestionJSWarning(args.questionJS);
        if (warning) response.warning = warning;
      }

      return toolSuccess(response);
    })
  );

  // Update question
  server.registerTool(
    "update_question",
    {
      description: "Update an existing question. Performs a safe partial update: fetches the current definition and carries all fields forward, so only the fields you pass change. For Matrix questions, choices = rows and answers = columns.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        questionId: z.string().min(1).describe("The question ID to update"),
        questionText: z.string().optional().describe("New question text"),
        choices: z.record(z.object({
          Display: z.string(),
        }).passthrough()).optional().describe("Updated choice definitions (rows/statements for Matrix). Extra per-choice Qualtrics fields pass through unchanged, e.g. TextEntry: \"true\" and TextEntrySize for an inline text box on a row"),
        choiceOrder: z.array(z.string()).optional().describe("Updated display order of choice keys (derived from choices if those change and this is omitted)"),
        answers: z.record(z.object({
          Display: z.string(),
        }).passthrough()).optional().describe("Updated answer definitions (columns/scale points for Matrix)"),
        answerOrder: z.array(z.string()).optional().describe("Updated display order of answer keys (derived from answers if those change and this is omitted)"),
        validation: z.record(z.any()).optional().describe("Updated validation settings"),
        configuration: z.record(z.any()).optional().describe("Updated Configuration object"),
        dataExportTag: z.string().trim().min(1).optional().describe("New export tag"),
        recodeValues: z.record(z.string()).optional().describe("Updated numeric recode mapping"),
        questionJS: z.string().optional().describe(QUESTION_JS_DESC + ' Pass empty string "" to clear existing JS.'),
        additionalFields: z.record(z.any()).optional().describe("Any other question-definition fields, merged into the payload last"),
      },
    },
    withErrorHandling("update_question", async (args) => {
      // Qualtrics PUT replaces the entire question — omitted fields get wiped.
      // Carry forward the full current definition so partial updates are safe.
      const current = await surveyApi.getQuestion(args.surveyId, args.questionId);
      const data: Record<string, any> = { ...current.result };
      delete data.QuestionID;
      delete data.QuestionText_Unsafe;

      // User-provided values override existing ones
      if (args.questionText !== undefined) data.QuestionText = args.questionText;
      if (args.choices !== undefined) {
        data.Choices = args.choices;
        data.ChoiceOrder = args.choiceOrder ?? Object.keys(args.choices);
        const maxChoiceId = Math.max(0, ...Object.keys(args.choices).map(Number).filter(Number.isFinite));
        if (typeof data.NextChoiceId === "number" && maxChoiceId >= data.NextChoiceId) {
          data.NextChoiceId = maxChoiceId + 1;
        }
      } else if (args.choiceOrder !== undefined) {
        data.ChoiceOrder = args.choiceOrder;
      }
      if (args.answers !== undefined) {
        data.Answers = args.answers;
        data.AnswerOrder = args.answerOrder ?? Object.keys(args.answers);
        const maxAnswerId = Math.max(0, ...Object.keys(args.answers).map(Number).filter(Number.isFinite));
        if (typeof data.NextAnswerId === "number" && maxAnswerId >= data.NextAnswerId) {
          data.NextAnswerId = maxAnswerId + 1;
        }
      } else if (args.answerOrder !== undefined) {
        data.AnswerOrder = args.answerOrder;
      }
      if (args.validation !== undefined) data.Validation = args.validation;
      if (args.configuration !== undefined) data.Configuration = args.configuration;
      if (args.dataExportTag !== undefined) data.DataExportTag = args.dataExportTag;
      if (args.recodeValues !== undefined) data.RecodeValues = args.recodeValues;
      if (args.questionJS !== undefined) data.QuestionJS = args.questionJS;
      if (args.additionalFields) Object.assign(data, args.additionalFields);

      // Never send immutable identifiers/read-only renderings, even when a
      // raw patch was copied from a previous GET response.
      delete data.QuestionID;
      delete data.QuestionText_Unsafe;

      const result = await surveyApi.updateQuestion(args.surveyId, args.questionId, data);

      const response: Record<string, any> = {
        success: true,
        surveyId: args.surveyId,
        questionId: args.questionId,
        message: "Question updated successfully",
        details: result.result,
      };

      if (args.questionJS) {
        const warning = checkQuestionJSWarning(args.questionJS);
        if (warning) response.warning = warning;
      }

      return toolSuccess(response);
    })
  );

  // Delete question
  server.registerTool(
    "delete_question",
    {
      description: "Remove a question from a survey",
      annotations: { destructiveHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        questionId: z.string().min(1).describe("The question ID to delete"),
        confirmDelete: z.boolean().describe("Must be true to confirm deletion"),
      },
    },
    withErrorHandling("delete_question", async (args) => {
      const guard = requireDeleteConfirmation(args);
      if (guard) return guard;
      const result = await surveyApi.deleteQuestion(args.surveyId, args.questionId);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        questionId: args.questionId,
        message: "Question deleted successfully",
        details: result.result,
      });
    })
  );

  // Add multiple choice question (simplified)
  server.registerTool(
    "add_multiple_choice_question",
    {
      description: "Simplified helper to create a multiple choice question. Automatically maps to the correct Qualtrics QuestionType/Selector.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        blockId: z.string().min(1).describe("The block ID to add the question to"),
        questionText: z.string().min(1).describe("The question text"),
        choices: z.array(z.string()).min(2).describe("Array of choice labels (e.g., ['Yes', 'No', 'Maybe'])"),
        allowMultiple: z.boolean().optional().describe("Allow selecting multiple choices (default: false)"),
        forceResponse: z.boolean().optional().describe("Require a response (default: false)"),
        dataExportTag: z.string().trim().min(1).optional().describe("Meaningful export tag; derived uniquely from questionText if omitted"),
        recodeValues: z.record(z.string()).optional().describe("Numeric recode mapping keyed by choice ID"),
      },
    },
    withErrorHandling("add_multiple_choice_question", async (args) => {
      const choicesObj: Record<string, { Display: string }> = {};
      args.choices.forEach((choice: string, index: number) => {
        choicesObj[String(index + 1)] = { Display: choice };
      });

      const questionData: Record<string, any> = {
        QuestionText: args.questionText,
        QuestionType: "MC",
        Selector: args.allowMultiple ? "MAVR" : "SAVR",
        SubSelector: "TX",
        DataExportTag: args.dataExportTag ?? await nextExportTag(surveyApi, args.surveyId, args.questionText),
        Choices: choicesObj,
        ChoiceOrder: args.choices.map((_: string, i: number) => String(i + 1)),
      };
      if (args.recodeValues) questionData.RecodeValues = args.recodeValues;

      if (args.forceResponse) {
        questionData.Validation = {
          Settings: {
            ForceResponse: "ON",
            ForceResponseType: "ON",
            Type: "None",
          },
        };
      }

      const result = await surveyApi.createQuestion(args.surveyId, args.blockId, questionData);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        blockId: args.blockId,
        questionId: result.result.QuestionID,
        questionType: args.allowMultiple ? "Multiple Choice (Multi-Answer)" : "Multiple Choice (Single Answer)",
        message: "Multiple choice question created successfully",
      });
    })
  );

  // Add text entry question (simplified)
  server.registerTool(
    "add_text_entry_question",
    {
      description: "Simplified helper to create a text entry question (single line, multi line, or essay).",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        blockId: z.string().min(1).describe("The block ID to add the question to"),
        questionText: z.string().min(1).describe("The question text"),
        textType: z.enum(["single", "multi", "essay"]).describe("Text entry type: single line, multi line, or essay"),
        forceResponse: z.boolean().optional().describe("Require a response (default: false)"),
        dataExportTag: z.string().trim().min(1).optional().describe("Meaningful export tag; derived uniquely from questionText if omitted"),
      },
    },
    withErrorHandling("add_text_entry_question", async (args) => {
      const selectorMap: Record<string, string> = {
        single: "SL",
        multi: "ML",
        essay: "ESTB",
      };

      const questionData: Record<string, any> = {
        QuestionText: args.questionText,
        QuestionType: "TE",
        Selector: selectorMap[args.textType],
        DataExportTag: args.dataExportTag ?? await nextExportTag(surveyApi, args.surveyId, args.questionText),
      };

      if (args.forceResponse) {
        questionData.Validation = {
          Settings: {
            ForceResponse: "ON",
            ForceResponseType: "ON",
            Type: "None",
          },
        };
      }

      const result = await surveyApi.createQuestion(args.surveyId, args.blockId, questionData);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        blockId: args.blockId,
        questionId: result.result.QuestionID,
        questionType: `Text Entry (${args.textType})`,
        message: "Text entry question created successfully",
      });
    })
  );

  // Add descriptive text question (simplified)
  server.registerTool(
    "add_descriptive_text_question",
    {
      description: "Simplified helper to create a descriptive text (DB/TB) question — commonly used for instructions, processing screens, or HTML content with optional JavaScript.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        blockId: z.string().min(1).describe("The block ID to add the question to"),
        htmlContent: z.string().min(1).describe("The HTML content to display"),
        questionJS: z.string().optional().describe(QUESTION_JS_DESC),
      },
    },
    withErrorHandling("add_descriptive_text_question", async (args) => {
      const questionData: Record<string, any> = {
        QuestionText: args.htmlContent,
        QuestionType: "DB",
        Selector: "TB",
      };
      const result = await surveyApi.createQuestion(args.surveyId, args.blockId, questionData);
      if (args.questionJS !== undefined) {
        await attachQuestionJs(
          surveyApi,
          args.surveyId,
          result.result.QuestionID,
          args.questionJS
        );
      }

      const response: Record<string, any> = {
        success: true,
        surveyId: args.surveyId,
        blockId: args.blockId,
        questionId: result.result.QuestionID,
        questionType: "Descriptive Text (DB/TB)",
        message: "Descriptive text question created successfully",
      };

      if (args.questionJS) {
        const warning = checkQuestionJSWarning(args.questionJS);
        if (warning) response.warning = warning;
      }

      return toolSuccess(response);
    })
  );

  // Add Likert question (simplified single-item MC/SAVR)
  server.registerTool(
    "add_likert_question",
    {
      description: "Simplified helper to create a single-item Likert scale as MC/SAVR. Includes preset scales so you don't have to enumerate choices manually.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        blockId: z.string().min(1).describe("The block ID to add the question to"),
        questionText: z.string().min(1).describe("The question text"),
        scale: z.enum(["agree5", "agree7", "frequency5", "satisfaction5", "likelihood5", "custom"]).describe(
          "Preset scale: agree5 (Strongly Disagree→Strongly Agree 5pt), agree7 (7pt), frequency5 (Never→Always), satisfaction5 (Very Dissatisfied→Very Satisfied), likelihood5 (Very Unlikely→Very Likely), or custom (provide customLabels)"
        ),
        customLabels: z.array(z.string()).optional().describe("Custom scale labels (required when scale is 'custom', minimum 2 items)"),
        forceResponse: z.boolean().optional().describe("Require a response (default: false)"),
        dataExportTag: z.string().trim().min(1).optional().describe("Meaningful export tag; derived uniquely from questionText if omitted"),
        recodeValues: z.record(z.string()).optional().describe("Numeric recode mapping keyed by scale choice ID"),
      },
    },
    withErrorHandling("add_likert_question", async (args) => {
      const presets: Record<string, string[]> = {
        agree5: ["Strongly Disagree", "Disagree", "Neither Agree nor Disagree", "Agree", "Strongly Agree"],
        agree7: ["Strongly Disagree", "Disagree", "Somewhat Disagree", "Neither Agree nor Disagree", "Somewhat Agree", "Agree", "Strongly Agree"],
        frequency5: ["Never", "Rarely", "Sometimes", "Often", "Always"],
        satisfaction5: ["Very Dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very Satisfied"],
        likelihood5: ["Very Unlikely", "Unlikely", "Neutral", "Likely", "Very Likely"],
      };

      let labels: string[];
      if (args.scale === "custom") {
        if (!args.customLabels || args.customLabels.length < 2) {
          return toolError("When scale is 'custom', customLabels must be provided with at least 2 items.");
        }
        labels = args.customLabels;
      } else {
        labels = presets[args.scale];
      }

      const choicesObj: Record<string, { Display: string }> = {};
      labels.forEach((label, index) => {
        choicesObj[String(index + 1)] = { Display: label };
      });

      const questionData: Record<string, any> = {
        QuestionText: args.questionText,
        QuestionType: "MC",
        Selector: "SAVR",
        SubSelector: "TX",
        DataExportTag: args.dataExportTag ?? await nextExportTag(surveyApi, args.surveyId, args.questionText),
        Choices: choicesObj,
        ChoiceOrder: labels.map((_, i) => String(i + 1)),
      };
      if (args.recodeValues) questionData.RecodeValues = args.recodeValues;

      if (args.forceResponse) {
        questionData.Validation = {
          Settings: {
            ForceResponse: "ON",
            ForceResponseType: "ON",
            Type: "None",
          },
        };
      }

      const result = await surveyApi.createQuestion(args.surveyId, args.blockId, questionData);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        blockId: args.blockId,
        questionId: result.result.QuestionID,
        questionType: `Likert (MC/SAVR, ${labels.length}-point)`,
        scale: args.scale,
        scaleLabels: labels,
        message: "Likert question created successfully",
      });
    })
  );

  // Add matrix question (simplified)
  server.registerTool(
    "add_matrix_question",
    {
      description:
        "Simplified helper to create a matrix question. Choices = rows/statements, Answers = columns/scale points. Defaults to a Likert single-answer matrix; use selector/subSelector for variants (e.g., selector 'CS' + subSelector 'WOTB' for matrix constant sum). Statements may be objects to enable an inline text-entry box on individual rows (e.g., an 'Other (please specify)' row).",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        blockId: z.string().min(1).describe("The block ID to add the question to"),
        questionText: z.string().min(1).describe("The question text/instructions"),
        statements: z.array(z.union([
          z.string(),
          z.object({
            text: z.string().min(1).describe("Statement/row label"),
            textEntry: z.boolean().optional().describe("Add an inline text-entry box to this row (e.g., for 'Other (please specify)')"),
            textEntrySize: z.enum(["Small", "Medium", "Large"]).optional().describe("Inline text box size; only meaningful with textEntry: true"),
          }),
        ])).min(1).describe("Array of statement/row labels; pass an object instead of a string to enable per-row inline text entry"),
        scalePoints: z.array(z.string()).min(2).describe("Array of scale point labels (e.g., ['Strongly Disagree', ..., 'Strongly Agree'])"),
        forceResponse: z.boolean().optional().describe("Require a response for all statements (default: false)"),
        selector: z.enum(["Likert", "Bipolar", "RO", "CS", "TE", "Profile", "MaxDiff"]).optional().describe("Matrix selector (default: Likert)"),
        subSelector: z
          .enum(["SingleAnswer", "MultipleAnswer", "DL", "DND", "TX", "Short", "Medium", "Long", "Essay", "WOTB", "WTB"])
          .optional()
          .describe("Sub-selector; must match the selector. Likert: SingleAnswer|MultipleAnswer|DL, RO: DND|TX, TE: Short|Medium|Long|Essay, CS: WOTB|WTB (default: SingleAnswer for Likert)"),
        dataExportTag: z.string().trim().min(1).optional().describe("Custom export tag for the question column names (recommended; derived uniquely from questionText if omitted)"),
        recodeValues: z.record(z.string()).optional().describe("Numeric recode mapping for scale points, keyed by answer id, e.g., {\"1\": \"1\", \"2\": \"2\"}"),
      },
    },
    withErrorHandling("add_matrix_question", async (args) => {
      const selector = args.selector ?? "Likert";
      const validSubs = MATRIX_SUBSELECTORS[selector];
      const subSelector = args.subSelector ?? validSubs[0];
      if (!validSubs.includes(subSelector)) {
        return toolError(
          `SubSelector '${subSelector}' is not valid for Matrix selector '${selector}'. Valid options: ${validSubs.join(", ")}.`
        );
      }

      const choices: Record<string, Record<string, string>> = {};
      args.statements.forEach(
        (statement: string | { text: string; textEntry?: boolean; textEntrySize?: string }, index: number) => {
          const key = String(index + 1);
          if (typeof statement === "string") {
            choices[key] = { Display: statement };
            return;
          }
          choices[key] = { Display: statement.text };
          if (statement.textEntry) {
            // Qualtrics stores row-level text entry as string flags on the choice.
            choices[key].TextEntry = "true";
            if (statement.textEntrySize) choices[key].TextEntrySize = statement.textEntrySize;
          }
        }
      );

      const questionData: Record<string, any> = {
        QuestionText: args.questionText,
        QuestionDescription: toQuestionDescription(args.questionText),
        QuestionType: "Matrix",
        Selector: selector,
        SubSelector: subSelector,
        DataExportTag: args.dataExportTag ?? await nextExportTag(surveyApi, args.surveyId, args.questionText),
        Choices: choices,
        ChoiceOrder: orderKeys(args.statements.length),
        Answers: buildDisplayMap(args.scalePoints),
        AnswerOrder: orderKeys(args.scalePoints.length),
        ChoiceDataExportTags: false,
        DefaultChoices: false,
        Configuration: { QuestionDescriptionOption: "UseText" },
        Language: [],
        Validation: validationSettings(args.forceResponse),
        NextChoiceId: args.statements.length + 1,
        NextAnswerId: args.scalePoints.length + 1,
      };
      if (args.recodeValues) questionData.RecodeValues = args.recodeValues;

      const result = await surveyApi.createQuestion(args.surveyId, args.blockId, questionData);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        blockId: args.blockId,
        questionId: result.result.QuestionID,
        questionType: `Matrix (${selector}/${subSelector})`,
        statementCount: args.statements.length,
        scalePointCount: args.scalePoints.length,
        message: "Matrix question created successfully",
      });
    })
  );

  // Add rank order question (simplified)
  server.registerTool(
    "add_rank_order_question",
    {
      description: "Simplified helper to create a rank order question where respondents rank a list of items.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        blockId: z.string().min(1).describe("The block ID to add the question to"),
        questionText: z.string().min(1).describe("The question text/instructions"),
        items: z.array(z.string()).min(2).describe("Array of item labels to rank"),
        selector: z.enum(["SB", "DND", "TX"]).optional().describe("DND = drag and drop (default and the only variation in the New Survey Taking Experience); SB = select box and TX = text box are legacy-experience variations"),
        forceResponse: z.boolean().optional().describe("Require a response (default: false)"),
        dataExportTag: z.string().trim().min(1).optional().describe("Custom export tag (recommended; generated uniquely if omitted)"),
      },
    },
    withErrorHandling("add_rank_order_question", async (args) => {
      const questionData: Record<string, any> = {
        QuestionText: args.questionText,
        QuestionDescription: toQuestionDescription(args.questionText),
        QuestionType: "RO",
        Selector: args.selector ?? "DND",
        DataExportTag: args.dataExportTag ?? await nextExportTag(surveyApi, args.surveyId, args.questionText),
        Choices: buildDisplayMap(args.items),
        ChoiceOrder: orderKeys(args.items.length),
        Configuration: { QuestionDescriptionOption: "UseText" },
        Language: [],
        Validation: validationSettings(args.forceResponse),
        NextChoiceId: args.items.length + 1,
        NextAnswerId: 1,
      };

      const result = await surveyApi.createQuestion(args.surveyId, args.blockId, questionData);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        blockId: args.blockId,
        questionId: result.result.QuestionID,
        questionType: `Rank Order (${args.selector ?? "DND"})`,
        itemCount: args.items.length,
        message: "Rank order question created successfully",
      });
    })
  );

  // Add constant sum question (simplified)
  server.registerTool(
    "add_constant_sum_question",
    {
      description:
        "Simplified helper to create a constant sum question where respondents allocate values across items (e.g., percentages summing to 100). The default Choices/text-entry variation works in the New Survey Taking Experience; bars and slider variations require the legacy experience.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        blockId: z.string().min(1).describe("The block ID to add the question to"),
        questionText: z.string().min(1).describe("The question text/instructions"),
        items: z.array(z.string()).min(2).describe("Array of item labels to allocate values across"),
        total: z.number().optional().describe("If set, entries must sum to exactly this total (e.g., 100)"),
        selector: z.enum(["VRTL", "HBAR", "HSLIDER"]).optional().describe("VRTL = Choices/text boxes (default; current experience compatible), HBAR = bars and HSLIDER = sliders (legacy experience only)"),
        forceResponse: z.boolean().optional().describe("Require a response (default: false)"),
        dataExportTag: z.string().trim().min(1).optional().describe("Custom export tag (recommended; generated uniquely if omitted)"),
      },
    },
    withErrorHandling("add_constant_sum_question", async (args) => {
      const validation = validationSettings(args.forceResponse);
      if (args.total !== undefined) {
        validation.Settings.Type = "ChoicesTotal";
        validation.Settings.EnforceRange = null;
        validation.Settings.ChoiceTotal = String(args.total);
      }

      const questionData: Record<string, any> = {
        QuestionText: args.questionText,
        QuestionDescription: toQuestionDescription(args.questionText),
        QuestionType: "CS",
        Selector: args.selector ?? "VRTL",
        DataExportTag: args.dataExportTag ?? await nextExportTag(surveyApi, args.surveyId, args.questionText),
        Choices: buildDisplayMap(args.items),
        ChoiceOrder: orderKeys(args.items.length),
        Configuration: { QuestionDescriptionOption: "UseText" },
        Language: [],
        Validation: validation,
        NextChoiceId: args.items.length + 1,
        NextAnswerId: 1,
      };
      if (args.selector === "HSLIDER" || args.selector === "HBAR") {
        questionData.Configuration.CSSliderMin = 0;
        questionData.Configuration.CSSliderMax = args.total ?? 100;
        questionData.Configuration.GridLines = 10;
      }

      const result = await surveyApi.createQuestion(args.surveyId, args.blockId, questionData);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        blockId: args.blockId,
        questionId: result.result.QuestionID,
        questionType: `Constant Sum (${args.selector ?? "VRTL"})`,
        itemCount: args.items.length,
        total: args.total,
        message: "Constant sum question created successfully",
      });
    })
  );

  // Get question template (for cloning)
  server.registerTool(
    "get_question_template",
    {
      description:
        "Get a question's full definition stripped of server-generated fields, ready to reuse as a create_question template (pass it via additionalFields). Best way to replicate complex question types (side-by-side, sliders, heatmaps): build one in the Qualtrics UI, then clone it via the API.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        questionId: z.string().min(1).describe("The question ID to use as a template (e.g., QID1)"),
      },
    },
    withErrorHandling("get_question_template", async (args) => {
      const result = await surveyApi.getQuestion(args.surveyId, args.questionId);
      const template = { ...result.result };
      delete template.QuestionID;
      delete template.QuestionText_Unsafe;
      delete template.QuestionText;
      delete template.DataExportTag;
      return toolSuccess({
        surveyId: args.surveyId,
        sourceQuestionId: args.questionId,
        template,
        usage:
          "Pass this object as create_question's additionalFields. create_question always applies its explicit questionText, questionType, selector, and new dataExportTag after the template.",
      });
    })
  );
}
