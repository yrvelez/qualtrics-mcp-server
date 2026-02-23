import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { SurveyApi } from "../services/survey-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolError, toolSuccess, withErrorHandling } from "./_helpers.js";

let questionCounter = 0;
function nextExportTag(): string {
  questionCounter++;
  return `Q_auto_${questionCounter}`;
}

const QUESTION_JS_DESC =
  "JavaScript to attach to this question (QuestionJS). IMPORTANT: Avoid literal `${` in JS strings — Qualtrics interprets it as piped text and corrupts the code. Use `\\x24{` or `String.fromCharCode(36)+'{'` instead.";

const PIPED_TEXT_PREFIXES = /\$\{(q|e|m|date|rand|lm|gr):\/\//i;

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

export function registerQuestionTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const surveyApi = new SurveyApi(client);

  // List questions
  server.tool(
    "list_questions",
    "List all questions in a survey with their types and a preview of the question text",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
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
  server.tool(
    "get_question",
    "Get the full definition of a specific question including choices, validation, and configuration",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      questionId: z.string().min(1).describe("The question ID (e.g., QID1)"),
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
  server.tool(
    "create_question",
    "Create a question in a survey block. For simplified helpers, use add_multiple_choice_question, add_text_entry_question, add_descriptive_text_question, add_likert_question, or add_matrix_question instead.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      blockId: z.string().min(1).describe("The block ID to add the question to"),
      questionText: z.string().min(1).describe("The question text (HTML supported)"),
      questionType: z.string().min(1).describe("Qualtrics question type (e.g., MC, TE, Matrix, Slider, RO, DB)"),
      selector: z.string().min(1).describe("Question selector (e.g., SAVR, MAVR, SL, ML, Likert, TB)"),
      subSelector: z.string().optional().describe("Sub-selector if applicable (e.g., TX, SingleAnswer)"),
      choices: z.record(z.object({
        Display: z.string(),
      })).optional().describe("Choice definitions keyed by choice number"),
      validation: z.record(z.any()).optional().describe("Validation settings"),
      questionJS: z.string().optional().describe(QUESTION_JS_DESC),
    },
    withErrorHandling("create_question", async (args) => {
      const questionData: Record<string, any> = {
        QuestionText: args.questionText,
        QuestionType: args.questionType,
        Selector: args.selector,
        DataExportTag: nextExportTag(),
      };
      if (args.subSelector) questionData.SubSelector = args.subSelector;
      if (args.choices) questionData.Choices = args.choices;
      if (args.validation) questionData.Validation = args.validation;
      if (args.questionJS !== undefined) questionData.QuestionJS = args.questionJS;

      const result = await surveyApi.createQuestion(args.surveyId, args.blockId, questionData);

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
  server.tool(
    "update_question",
    "Update an existing question's text, choices, validation, or JavaScript",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      questionId: z.string().min(1).describe("The question ID to update"),
      questionText: z.string().optional().describe("New question text"),
      choices: z.record(z.object({
        Display: z.string(),
      })).optional().describe("Updated choice definitions"),
      validation: z.record(z.any()).optional().describe("Updated validation settings"),
      questionJS: z.string().optional().describe(QUESTION_JS_DESC + ' Pass empty string "" to clear existing JS.'),
    },
    withErrorHandling("update_question", async (args) => {
      // Qualtrics PUT requires QuestionType — auto-fetch current question
      const current = await surveyApi.getQuestion(args.surveyId, args.questionId);
      const currentQ = current.result;
      const data: Record<string, any> = {
        QuestionType: currentQ.QuestionType,
        Selector: currentQ.Selector,
      };
      if (currentQ.SubSelector) data.SubSelector = currentQ.SubSelector;
      if (args.questionText !== undefined) data.QuestionText = args.questionText;
      if (args.choices !== undefined) data.Choices = args.choices;
      if (args.validation !== undefined) data.Validation = args.validation;
      if (args.questionJS !== undefined) data.QuestionJS = args.questionJS;

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
  server.tool(
    "delete_question",
    "Remove a question from a survey",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      questionId: z.string().min(1).describe("The question ID to delete"),
    },
    withErrorHandling("delete_question", async (args) => {
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
  server.tool(
    "add_multiple_choice_question",
    "Simplified helper to create a multiple choice question. Automatically maps to the correct Qualtrics QuestionType/Selector.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      blockId: z.string().min(1).describe("The block ID to add the question to"),
      questionText: z.string().min(1).describe("The question text"),
      choices: z.array(z.string()).min(2).describe("Array of choice labels (e.g., ['Yes', 'No', 'Maybe'])"),
      allowMultiple: z.boolean().optional().describe("Allow selecting multiple choices (default: false)"),
      forceResponse: z.boolean().optional().describe("Require a response (default: false)"),
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
        DataExportTag: nextExportTag(),
        Choices: choicesObj,
        ChoiceOrder: args.choices.map((_: string, i: number) => String(i + 1)),
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
        questionType: args.allowMultiple ? "Multiple Choice (Multi-Answer)" : "Multiple Choice (Single Answer)",
        message: "Multiple choice question created successfully",
      });
    })
  );

  // Add text entry question (simplified)
  server.tool(
    "add_text_entry_question",
    "Simplified helper to create a text entry question (single line, multi line, or essay).",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      blockId: z.string().min(1).describe("The block ID to add the question to"),
      questionText: z.string().min(1).describe("The question text"),
      textType: z.enum(["single", "multi", "essay"]).describe("Text entry type: single line, multi line, or essay"),
      forceResponse: z.boolean().optional().describe("Require a response (default: false)"),
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
        DataExportTag: nextExportTag(),
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
  server.tool(
    "add_descriptive_text_question",
    "Simplified helper to create a descriptive text (DB/TB) question — commonly used for instructions, processing screens, or HTML content with optional JavaScript.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      blockId: z.string().min(1).describe("The block ID to add the question to"),
      htmlContent: z.string().min(1).describe("The HTML content to display"),
      questionJS: z.string().optional().describe(QUESTION_JS_DESC),
    },
    withErrorHandling("add_descriptive_text_question", async (args) => {
      const questionData: Record<string, any> = {
        QuestionText: args.htmlContent,
        QuestionType: "DB",
        Selector: "TB",
        DataExportTag: nextExportTag(),
      };
      if (args.questionJS !== undefined) questionData.QuestionJS = args.questionJS;

      const result = await surveyApi.createQuestion(args.surveyId, args.blockId, questionData);

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
  server.tool(
    "add_likert_question",
    "Simplified helper to create a single-item Likert scale as MC/SAVR. Includes preset scales so you don't have to enumerate choices manually.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      blockId: z.string().min(1).describe("The block ID to add the question to"),
      questionText: z.string().min(1).describe("The question text"),
      scale: z.enum(["agree5", "agree7", "frequency5", "satisfaction5", "likelihood5", "custom"]).describe(
        "Preset scale: agree5 (Strongly Disagree→Strongly Agree 5pt), agree7 (7pt), frequency5 (Never→Always), satisfaction5 (Very Dissatisfied→Very Satisfied), likelihood5 (Very Unlikely→Very Likely), or custom (provide customLabels)"
      ),
      customLabels: z.array(z.string()).optional().describe("Custom scale labels (required when scale is 'custom', minimum 2 items)"),
      forceResponse: z.boolean().optional().describe("Require a response (default: false)"),
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
        DataExportTag: nextExportTag(),
        Choices: choicesObj,
        ChoiceOrder: labels.map((_, i) => String(i + 1)),
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
        questionType: `Likert (MC/SAVR, ${labels.length}-point)`,
        scale: args.scale,
        scaleLabels: labels,
        message: "Likert question created successfully",
      });
    })
  );

  // Add matrix question (simplified)
  server.tool(
    "add_matrix_question",
    "Simplified helper to create a Likert/matrix question with statements and scale points.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      blockId: z.string().min(1).describe("The block ID to add the question to"),
      questionText: z.string().min(1).describe("The question text/instructions"),
      statements: z.array(z.string()).min(1).describe("Array of statement/row labels"),
      scalePoints: z.array(z.string()).min(2).describe("Array of scale point labels (e.g., ['Strongly Disagree', ..., 'Strongly Agree'])"),
      forceResponse: z.boolean().optional().describe("Require a response for all statements (default: false)"),
    },
    withErrorHandling("add_matrix_question", async (args) => {
      const choices: Record<string, { Display: string }> = {};
      args.statements.forEach((stmt: string, index: number) => {
        choices[String(index + 1)] = { Display: stmt };
      });

      const answers: Record<string, { Display: string }> = {};
      args.scalePoints.forEach((point: string, index: number) => {
        answers[String(index + 1)] = { Display: point };
      });

      const questionData: Record<string, any> = {
        QuestionText: args.questionText,
        QuestionType: "Matrix",
        Selector: "Likert",
        SubSelector: "SingleAnswer",
        DataExportTag: nextExportTag(),
        Choices: choices,
        ChoiceOrder: args.statements.map((_: string, i: number) => String(i + 1)),
        Answers: answers,
        AnswerOrder: args.scalePoints.map((_: string, i: number) => String(i + 1)),
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
        questionType: "Matrix (Likert)",
        statementCount: args.statements.length,
        scalePointCount: args.scalePoints.length,
        message: "Matrix question created successfully",
      });
    })
  );
}
