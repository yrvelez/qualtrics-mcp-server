import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createQualtricsServer } from "../src/server.js";

const EXPECTED_TOOL_COUNT = 110;

test("server registers the complete unique tool catalog with serializable schemas", async () => {
  const originalEnv = {
    apiToken: process.env.QUALTRICS_API_TOKEN,
    dataCenter: process.env.QUALTRICS_DATA_CENTER,
    readOnly: process.env.QUALTRICS_READ_ONLY,
  };
  process.env.QUALTRICS_API_TOKEN = "test-token";
  process.env.QUALTRICS_DATA_CENTER = "test";
  process.env.QUALTRICS_READ_ONLY = "true";

  const server = await createQualtricsServer();
  const client = new Client({ name: "registration-test", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    assert.equal(
      tools.length,
      EXPECTED_TOOL_COUNT,
      "tool-count changes must be reflected in the catalog documentation and this contract test"
    );
    assert.equal(new Set(names).size, tools.length, "tool names must be unique");
    assert.ok(names.includes("qualtrics_api_request"));
    assert.ok(names.includes("set_write_scopes"));
    assert.ok(names.includes("set_read_only_mode"));
    for (const name of [
      "get_survey_metadata",
      "update_survey_options",
      "create_survey_version",
      "update_survey_translations",
      "create_quota",
      "create_quota_group",
      "copy_survey",
      "import_survey_qsf",
      "import_survey_docx",
      "create_library_message",
      "list_library_blocks",
      "list_library_questions",
      "list_library_surveys",
      "upload_library_graphic",
      "delete_library_graphic",
      "insert_flow_element",
      "move_flow_element",
      "delete_flow_element",
      "validate_survey_design",
      "update_mailing_list",
      "get_contact",
    ]) {
      assert.ok(names.includes(name), `expected newly supported tool ${name}`);
    }

    for (const tool of tools) {
      assert.ok(tool.description, `${tool.name} must have a description`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name} schema type`);
      assert.ok(tool.inputSchema.properties, `${tool.name} schema properties`);
    }

    const advancedTool = tools.find((tool) => tool.name === "qualtrics_api_request");
    assert.ok(advancedTool);
    assert.deepEqual(advancedTool.inputSchema.required, ["method", "path"]);
    assert.match(JSON.stringify(advancedTool.inputSchema), /confirmDelete/);

    const scopeTool = tools.find((tool) => tool.name === "set_write_scopes");
    assert.ok(scopeTool);
    assert.match(JSON.stringify(scopeTool.inputSchema), /advanced/);
    assert.match(JSON.stringify(scopeTool.inputSchema), /libraries/);

    const languagesTool = tools.find((tool) => tool.name === "update_survey_languages");
    assert.ok(languagesTool);
    assert.ok(languagesTool.inputSchema.required?.includes("surveyId"));
    assert.ok(languagesTool.inputSchema.required?.includes("availableLanguages"));

    const cascadeTool = tools.find((tool) => tool.name === "delete_quota_group");
    assert.ok(cascadeTool);
    assert.ok(cascadeTool.inputSchema.required?.includes("confirmDelete"));
    assert.ok(cascadeTool.inputSchema.required?.includes("confirmCascade"));

    const contactTools = [
      "list_mailing_lists",
      "get_mailing_list",
      "update_mailing_list",
      "create_mailing_list",
      "delete_mailing_list",
      "list_contacts",
      "get_contact",
      "add_contact",
      "update_contact",
      "remove_contact",
      "bulk_import_contacts",
    ];
    for (const name of contactTools) {
      const tool = tools.find((candidate) => candidate.name === name);
      assert.ok(tool, `missing contact tool ${name}`);
      assert.ok(
        tool.inputSchema.required?.includes("directoryId"),
        `${name} must require an XM directoryId`
      );
    }
  } finally {
    await client.close();
    await server.close();

    if (originalEnv.apiToken === undefined) delete process.env.QUALTRICS_API_TOKEN;
    else process.env.QUALTRICS_API_TOKEN = originalEnv.apiToken;
    if (originalEnv.dataCenter === undefined) delete process.env.QUALTRICS_DATA_CENTER;
    else process.env.QUALTRICS_DATA_CENTER = originalEnv.dataCenter;
    if (originalEnv.readOnly === undefined) delete process.env.QUALTRICS_READ_ONLY;
    else process.env.QUALTRICS_READ_ONLY = originalEnv.readOnly;
  }
});
