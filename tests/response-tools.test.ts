import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QualtricsClient } from "../src/services/qualtrics-client.js";
import { ResponseApi } from "../src/services/response-api.js";
import { exportJobState, registerResponseTools } from "../src/tools/response-tools.js";

test("response exports complete only with terminal complete status and a file ID", () => {
  assert.deepEqual(exportJobState({ status: "complete", fileId: "FILE_1" }), {
    status: "complete",
    complete: true,
    failed: false,
    fileId: "FILE_1",
  });
  assert.equal(
    exportJobState({ status: "inProgress", percentComplete: 100, fileId: "FILE_1" }).complete,
    false
  );
  assert.equal(
    exportJobState({ status: "complete", percentComplete: 100, fileId: null }).complete,
    false
  );
});

test("failed 100-percent response exports remain failed, not downloadable", () => {
  const state = exportJobState({
    status: "failed",
    percentComplete: 100,
    fileId: null,
  });
  assert.equal(state.failed, true);
  assert.equal(state.complete, false);
  assert.equal(state.fileId, null);
});

test("response export tools normalize the default format and send only documented filters", async () => {
  const starts: Array<{ surveyId: string; format: string; filters?: Record<string, unknown> }> = [];
  const fakeClient = {
    async startResponseExport(
      surveyId: string,
      format: string,
      filters?: Record<string, unknown>
    ) {
      starts.push({ surveyId, format, filters });
      return { result: { progressId: `ES_${starts.length}` } };
    },
  } as unknown as QualtricsClient;

  const server = new McpServer({ name: "response-test", version: "1.0.0" });
  registerResponseTools(server, fakeClient, {} as never);
  const client = new Client({ name: "response-test-client", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const unfiltered = await client.callTool({
      name: "export_responses",
      arguments: { surveyId: "SV_1", waitForCompletion: false },
    });
    assert.notEqual(unfiltered.isError, true);
    assert.equal(starts[0].format, "json");
    const unfilteredBody = JSON.parse((unfiltered.content[0] as { text: string }).text);
    assert.equal(unfilteredBody.format, "json");

    const filtered = await client.callTool({
      name: "export_responses_filtered",
      arguments: {
        surveyId: "SV_1",
        waitForCompletion: false,
        startDate: "2026-01-01T00:00:00Z",
        filterId: "FILTER_1",
        includeResponsesInProgress: true,
        questionIds: ["QID1"],
      },
    });
    assert.notEqual(filtered.isError, true);
    assert.equal(starts[1].format, "json");
    assert.deepEqual(starts[1].filters, {
      startDate: "2026-01-01T00:00:00Z",
      filterId: "FILTER_1",
      exportResponsesInProgress: true,
      questionIds: ["QID1"],
    });
    assert.equal("filterType" in (starts[1].filters ?? {}), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("individual response updates use the documented asynchronous embedded-data job", async () => {
  const calls: Array<{ endpoint: string; options: RequestInit }> = [];
  const fakeClient = {
    async makeRequest(endpoint: string, options: RequestInit = {}) {
      calls.push({ endpoint, options });
      return { result: { progressId: "JOB_1" } };
    },
  } as unknown as QualtricsClient;

  const responseApi = new ResponseApi(fakeClient);
  await responseApi.updateResponseEmbeddedData(
    "SV_1",
    "R_1",
    { ticketStatus: "open" },
    true
  );

  assert.equal(calls[0].endpoint, "/surveys/SV_1/update-responses");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body as string), {
    updates: [{
      responseId: "R_1",
      resetRecordedDate: true,
      embeddedData: { ticketStatus: "open" },
    }],
    removeEdits: false,
    ignoreMissingResponses: false,
  });
});

test("response export failures never start an implicit second export", async () => {
  const starts: Array<{ surveyId: string; format: string }> = [];
  const fakeClient = {
    async startResponseExport(surveyId: string, format: string) {
      starts.push({ surveyId, format });
      throw new Error("deliberate export failure");
    },
  } as unknown as QualtricsClient;

  const server = new McpServer({ name: "response-no-retry-test", version: "1.0.0" });
  registerResponseTools(server, fakeClient, {} as never);
  const client = new Client({ name: "response-no-retry-client", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const unfiltered = await client.callTool({
      name: "export_responses",
      arguments: { surveyId: "SV_1", format: "csv" },
    });
    assert.equal(unfiltered.isError, true);

    const filtered = await client.callTool({
      name: "export_responses_filtered",
      arguments: { surveyId: "SV_2", format: "json" },
    });
    assert.equal(filtered.isError, true);

    assert.deepEqual(starts, [
      { surveyId: "SV_1", format: "csv" },
      { surveyId: "SV_2", format: "json" },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
