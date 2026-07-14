/**
 * Complete MCP-only survey-programming example.
 *
 * This script never imports QualtricsClient or a REST service. Every operation
 * goes through the same MCP tools available to an AI client. It creates a
 * draft survey but deliberately does not activate it.
 *
 * Run from the repository root after configuring .env:
 *   node --env-file=.env --import tsx examples/motivated-reasoning-study.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, any>;

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function resultText(result: any): string {
  const text = result?.content?.find((item: any) => item.type === "text")?.text;
  return typeof text === "string" ? text : "";
}

async function main() {
  const serverEntrypoint = fileURLToPath(
    new URL("../build/index.js", import.meta.url)
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntrypoint],
    cwd: process.cwd(),
    env: inheritedEnvironment(),
    stderr: "inherit",
  });
  const client = new Client({
    name: "motivated-reasoning-example",
    version: "1.0.0",
  });

  await client.connect(transport);

  async function call<T extends JsonObject = JsonObject>(
    name: string,
    args: JsonObject
  ): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const text = resultText(result);
    if (result.isError) throw new Error(`${name}: ${text}`);
    try {
      return JSON.parse(text) as T;
    } catch {
      // Server-control tools return human-readable status text; API-backed
      // tools return JSON. Preserve both through one MCP call helper.
      return { message: text } as unknown as T;
    }
  }

  try {
    // This example creates a new draft and edits only that draft. It grants the
    // minimum three scopes required for survey construction.
    await call("set_write_scopes", {
      scopes: ["surveys", "questionsAndBlocks", "surveyDesign"],
    });

    const created = await call("create_survey", {
      name: "Motivated Reasoning: Counterargument Experiment (MCP Example)",
      language: "EN",
      projectCategory: "CORE",
    });
    const surveyId = created.surveyId as string;
    const defaultBlockId = created.details.DefaultBlockID as string;

    await call("update_block", {
      surveyId,
      blockId: defaultBlockId,
      description: "Consent and Issue Identification",
    });

    async function createBlock(description: string): Promise<string> {
      const block = await call("create_block", { surveyId, description });
      return block.blockId as string;
    }

    const preBlockId = await createBlock("Pre-Treatment Measures");
    const counterargumentBlockId = await createBlock("Treatment: Counterargument");
    const controlBlockId = await createBlock("Control: Unrelated Argument");
    const postBlockId = await createBlock("Post-Treatment Measures");
    const debriefBlockId = await createBlock("Debriefing");

    await call("add_descriptive_text_question", {
      surveyId,
      blockId: defaultBlockId,
      htmlContent:
        "<h2>Research Consent</h2><p>This study examines how people evaluate arguments. Participation is voluntary.</p>",
    });
    await call("add_multiple_choice_question", {
      surveyId,
      blockId: defaultBlockId,
      questionText: "Do you consent to participate?",
      choices: ["Yes, I consent", "No, I do not consent"],
      forceResponse: true,
      dataExportTag: "Consent",
      recodeValues: { "1": "1", "2": "0" },
    });
    const issueQuestion = await call("add_text_entry_question", {
      surveyId,
      blockId: defaultBlockId,
      questionText:
        "What political or social issue is most important to you right now?",
      textType: "essay",
      forceResponse: true,
      dataExportTag: "ParticipantIssue",
    });

    const preQuestion = await call("add_likert_question", {
      surveyId,
      blockId: preBlockId,
      questionText:
        "My current position on this issue is supported by strong evidence.",
      scale: "agree7",
      forceResponse: true,
      dataExportTag: "PreEvidenceConfidence",
      recodeValues: {
        "1": "1",
        "2": "2",
        "3": "3",
        "4": "4",
        "5": "5",
        "6": "6",
        "7": "7",
      },
    });

    await call("add_descriptive_text_question", {
      surveyId,
      blockId: counterargumentBlockId,
      htmlContent:
        "<h3>Counterargument</h3><p>Consider a careful challenge to your position on <strong>\${e://Field/ParticipantIssue}</strong>. What evidence would most seriously count against your present view?</p>",
      questionJS:
        "Qualtrics.SurveyEngine.addOnReady(function(){ this.getQuestionContainer().setAttribute('data-condition','counterargument'); });",
    });
    await call("add_text_entry_question", {
      surveyId,
      blockId: counterargumentBlockId,
      questionText: "Briefly describe the strongest counterargument you can identify.",
      textType: "essay",
      forceResponse: true,
      dataExportTag: "CounterargumentResponse",
    });

    await call("add_descriptive_text_question", {
      surveyId,
      blockId: controlBlockId,
      htmlContent:
        "<h3>Control Reading</h3><p>Consider the practical advantages and disadvantages of permanent standard time.</p>",
    });
    await call("add_text_entry_question", {
      surveyId,
      blockId: controlBlockId,
      questionText: "Briefly describe the strongest consideration in this debate.",
      textType: "essay",
      forceResponse: true,
      dataExportTag: "ControlArgumentResponse",
    });

    await call("add_likert_question", {
      surveyId,
      blockId: postBlockId,
      questionText:
        "My current position on this issue is supported by strong evidence.",
      scale: "agree7",
      forceResponse: true,
      dataExportTag: "PostEvidenceConfidence",
      recodeValues: {
        "1": "1",
        "2": "2",
        "3": "3",
        "4": "4",
        "5": "5",
        "6": "6",
        "7": "7",
      },
    });
    await call("add_likert_question", {
      surveyId,
      blockId: postBlockId,
      questionText: "I would be willing to reconsider my position on this issue.",
      scale: "agree7",
      forceResponse: true,
      dataExportTag: "PostWillingnessToReconsider",
    });
    await call("add_descriptive_text_question", {
      surveyId,
      blockId: debriefBlockId,
      htmlContent:
        "<h2>Debriefing</h2><p>You were randomly assigned to reflect on either a counterargument to your own issue or an unrelated control topic. The study tests motivated reasoning.</p>",
    });

    // Full raw flow remains available when it is the clearest way to express a
    // nested experimental design. Every FlowID is unique and Count equals the
    // highest numeric ID.
    const currentFlow = await call("get_survey_flow", { surveyId });
    await call("update_survey_flow", {
      surveyId,
      flow: {
        // The full-flow PUT also requires the server-created root FlowID and
        // Type, so preserve all root fields while replacing its children.
        ...currentFlow.flow,
        Flow: [
          {
            FlowID: "FL_100",
            Type: "EmbeddedData",
            EmbeddedData: [
              {
                Description: "Condition",
                Type: "Custom",
                Field: "Condition",
                VariableType: "String",
                DataVisibility: [],
                AnalyzeText: false,
                Value: "",
              },
              {
                Description: "ParticipantIssue",
                Type: "Custom",
                Field: "ParticipantIssue",
                VariableType: "String",
                DataVisibility: [],
                AnalyzeText: false,
                Value: "",
              },
            ],
          },
          { FlowID: "FL_101", Type: "Block", ID: defaultBlockId, Autofill: [] },
          {
            FlowID: "FL_102",
            Type: "EmbeddedData",
            EmbeddedData: [
              {
                Description: "ParticipantIssue",
                Type: "Custom",
                Field: "ParticipantIssue",
                VariableType: "String",
                DataVisibility: [],
                AnalyzeText: false,
                Value: `\${q://${issueQuestion.questionId}/ChoiceTextEntryValue}`,
              },
            ],
          },
          { FlowID: "FL_103", Type: "Block", ID: preBlockId, Autofill: [] },
          {
            FlowID: "FL_104",
            Type: "BlockRandomizer",
            SubSet: 1,
            EvenPresentation: true,
            Flow: [
              {
                FlowID: "FL_105",
                Type: "Group",
                Description: "Counterargument condition",
                Flow: [
                  {
                    FlowID: "FL_106",
                    Type: "EmbeddedData",
                    EmbeddedData: [
                      {
                        Description: "Condition",
                        Type: "Custom",
                        Field: "Condition",
                        VariableType: "String",
                        DataVisibility: [],
                        AnalyzeText: false,
                        Value: "counterargument",
                      },
                    ],
                  },
                  {
                    FlowID: "FL_107",
                    Type: "Block",
                    ID: counterargumentBlockId,
                    Autofill: [],
                  },
                ],
              },
              {
                FlowID: "FL_108",
                Type: "Group",
                Description: "Control condition",
                Flow: [
                  {
                    FlowID: "FL_109",
                    Type: "EmbeddedData",
                    EmbeddedData: [
                      {
                        Description: "Condition",
                        Type: "Custom",
                        Field: "Condition",
                        VariableType: "String",
                        DataVisibility: [],
                        AnalyzeText: false,
                        Value: "control",
                      },
                    ],
                  },
                  {
                    FlowID: "FL_110",
                    Type: "Block",
                    ID: controlBlockId,
                    Autofill: [],
                  },
                ],
              },
            ],
          },
          { FlowID: "FL_111", Type: "Block", ID: postBlockId, Autofill: [] },
          { FlowID: "FL_112", Type: "Block", ID: debriefBlockId, Autofill: [] },
        ],
        Properties: {
          ...(currentFlow.flow?.Properties ?? {}),
          Count: 112,
          RemovedFieldsets:
            currentFlow.flow?.Properties?.RemovedFieldsets ?? [],
        },
      },
    });

    await call("update_survey_options", {
      surveyId,
      backButton: true,
      progressBarDisplay: "Text",
      partialData: "+1 week",
      anonymizeResponse: "Yes",
      surveyTermination: "DefaultMessage",
    });

    const validation = await call("validate_survey_design", { surveyId });
    if (!validation.valid) {
      throw new Error(
        `Survey validation failed:\n${(validation.errors as string[]).join("\n")}`
      );
    }

    const version = await call("create_survey_version", {
      surveyId,
      description: "Initial MCP-programmed draft",
      published: false,
    });

    console.log(
      JSON.stringify(
        {
          surveyId,
          versionId: version.versionId,
          preQuestionId: preQuestion.questionId,
          validation,
          status: "draft-not-activated",
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
