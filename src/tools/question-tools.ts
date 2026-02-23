import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { SurveyApi } from "../services/survey-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolError, toolSuccess, withErrorHandling } from "./_helpers.js";

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
    "Create a question in a survey block. For simplified helpers, use add_multiple_choice_question, add_text_entry_question, or add_matrix_question instead.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      blockId: z.string().min(1).describe("The block ID to add the question to"),
      questionText: z.string().min(1).describe("The question text (HTML supported)"),
      questionType: z.string().min(1).describe("Qualtrics question type (e.g., MC, TE, Matrix, Slider, RO)"),
      selector: z.string().min(1).describe("Question selector (e.g., SAVR, MAVR, SL, ML, Likert)"),
      subSelector: z.string().optional().describe("Sub-selector if applicable (e.g., TX, SingleAnswer)"),
      choices: z.record(z.object({
        Display: z.string(),
      })).optional().describe("Choice definitions keyed by choice number"),
      validation: z.record(z.any()).optional().describe("Validation settings"),
    },
    withErrorHandling("create_question", async (args) => {
      const questionData: Record<string, any> = {
        QuestionText: args.questionText,
        QuestionType: args.questionType,
        Selector: args.selector,
      };
      if (args.subSelector) questionData.SubSelector = args.subSelector;
      if (args.choices) questionData.Choices = args.choices;
      if (args.validation) questionData.Validation = args.validation;

      const result = await surveyApi.createQuestion(args.surveyId, args.blockId, questionData);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        blockId: args.blockId,
        questionId: result.result.QuestionID,
        message: "Question created successfully",
        details: result.result,
      });
    })
  );

  // Update question
  server.tool(
    "update_question",
    "Update an existing question's text, choices, or validation settings",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      questionId: z.string().min(1).describe("The question ID to update"),
      questionText: z.string().optional().describe("New question text"),
      choices: z.record(z.object({
        Display: z.string(),
      })).optional().describe("Updated choice definitions"),
      validation: z.record(z.any()).optional().describe("Updated validation settings"),
    },
    withErrorHandling("update_question", async (args) => {
      const data: Record<string, any> = {};
      if (args.questionText !== undefined) data.QuestionText = args.questionText;
      if (args.choices !== undefined) data.Choices = args.choices;
      if (args.validation !== undefined) data.Validation = args.validation;

      const result = await surveyApi.updateQuestion(args.surveyId, args.questionId, data);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        questionId: args.questionId,
        message: "Question updated successfully",
        details: result.result,
      });
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
