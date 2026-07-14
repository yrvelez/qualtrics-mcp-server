import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QualtricsClient } from "../src/services/qualtrics-client.js";
import { registerQuestionTools } from "../src/tools/question-tools.js";

type Call = { endpoint: string; options: RequestInit };

async function withQuestionTools(
  run: (client: Client, calls: Call[]) => Promise<void>
): Promise<void> {
  const calls: Call[] = [];
  const fakeClient = {
    async makeRequest(endpoint: string, options: RequestInit = {}) {
      calls.push({ endpoint, options });
      if (options.method === "POST") {
        return { result: { QuestionID: "QID_NEW" } };
      }
      if (options.method === "PUT") return { result: {} };
      if (endpoint.endsWith("/questions")) {
        return {
          result: {
            elements: [
              {
                QuestionID: "QID_OLD",
                DataExportTag: "Same_question",
              },
            ],
          },
        };
      }
      return {
        result: {
          QuestionID: "QID_NEW",
          QuestionText: "Created text",
          QuestionType: "DB",
          Selector: "TB",
        },
      };
    },
  } as unknown as QualtricsClient;

  const server = new McpServer({ name: "question-test", version: "1.0.0" });
  registerQuestionTools(server, fakeClient, {} as never);
  const client = new Client({ name: "question-test-client", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await run(client, calls);
  } finally {
    await client.close();
    await server.close();
  }
}

function jsonBody(call: Call): Record<string, any> {
  assert.equal(typeof call.options.body, "string");
  return JSON.parse(call.options.body as string);
}

test("descriptive QuestionJS is attached with a safe GET plus full PUT", async () => {
  await withQuestionTools(async (client, calls) => {
    const result = await client.callTool({
      name: "add_descriptive_text_question",
      arguments: {
        surveyId: "SV_JS",
        blockId: "BL_1",
        htmlContent: "<p>Loading</p>",
        questionJS: "Qualtrics.SurveyEngine.addOnReady(function() {});",
      },
    });
    assert.notEqual(result.isError, true);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(jsonBody(calls[0]).QuestionJS, undefined);
    assert.equal(calls[1].options.method, undefined);
    assert.equal(calls[2].options.method, "PUT");
    const update = jsonBody(calls[2]);
    assert.equal(
      update.QuestionJS,
      "Qualtrics.SurveyEngine.addOnReady(function() {});"
    );
    assert.equal(update.QuestionID, undefined);
  });
});

test("raw question templates cannot override explicit fields and auto tags avoid live collisions", async () => {
  await withQuestionTools(async (client, calls) => {
    const result = await client.callTool({
      name: "create_question",
      arguments: {
        surveyId: "SV_TEMPLATE",
        blockId: "BL_1",
        questionText: "Same question",
        questionType: "MC",
        selector: "SAVR",
        choices: { "1": { Display: "Yes" }, "2": { Display: "No" } },
        additionalFields: {
          QuestionID: "QID_OLD",
          QuestionText: "Old text",
          QuestionType: "DB",
          Selector: "TB",
          DataExportTag: "OldTag",
          QuestionJS: "safeJs();",
        },
      },
    });
    assert.notEqual(result.isError, true);

    const createCall = calls.find((call) => call.options.method === "POST");
    assert.ok(createCall);
    const body = jsonBody(createCall);
    assert.equal(body.QuestionText, "Same question");
    assert.equal(body.QuestionType, "MC");
    assert.equal(body.Selector, "SAVR");
    assert.equal(body.DataExportTag, "Same_question_2");
    assert.equal(body.QuestionID, undefined);
    assert.equal(body.QuestionJS, undefined);

    const updateCall = calls.find((call) => call.options.method === "PUT");
    assert.ok(updateCall);
    assert.equal(jsonBody(updateCall).QuestionJS, "safeJs();");
  });
});

test("matrix rows accept per-statement inline text entry", async () => {
  await withQuestionTools(async (client, calls) => {
    const result = await client.callTool({
      name: "add_matrix_question",
      arguments: {
        surveyId: "SV_1",
        blockId: "BL_1",
        questionText: "Rate each source",
        dataExportTag: "SourceRatings",
        statements: [
          "Newspapers",
          { text: "Television" },
          { text: "Other (please specify)", textEntry: true, textEntrySize: "Medium" },
        ],
        scalePoints: ["Never", "Sometimes", "Often"],
      },
    });
    assert.notEqual(result.isError, true);

    const createCall = calls.find((call) => call.options.method === "POST");
    assert.ok(createCall);
    const body = jsonBody(createCall);
    assert.equal(body.QuestionType, "Matrix");
    assert.deepEqual(body.Choices, {
      "1": { Display: "Newspapers" },
      "2": { Display: "Television" },
      "3": {
        Display: "Other (please specify)",
        TextEntry: "true",
        TextEntrySize: "Medium",
      },
    });
    assert.deepEqual(body.ChoiceOrder, ["1", "2", "3"]);
    assert.deepEqual(body.Answers, {
      "1": { Display: "Never" },
      "2": { Display: "Sometimes" },
      "3": { Display: "Often" },
    });
  });
});
