import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient, type WriteScope } from "../src/services/qualtrics-client.js";
import { registerApiTools, validateApiPath } from "../src/tools/api-tools.js";

test("validateApiPath accepts ordinary Qualtrics API v3 paths", () => {
  for (const path of [
    "/surveys",
    "/survey-definitions/SV_123/questions",
    "/directories/DIR_123/contacts",
  ]) {
    assert.equal(validateApiPath(path), null, path);
  }
});

test("validateApiPath rejects alternate origins and inline URL components", () => {
  for (const path of [
    "surveys",
    "//example.com/surveys",
    "https://example.com/surveys",
    "/surveys?offset=1",
    "/surveys#responses",
    "/survey-definitions\\SV_123",
    "/distributions/EMD_1/links/",
    "/distributions//EMD_1/links",
    "/survey definitions/SV_123",
    "/survey-definitions\n/SV_123",
  ]) {
    assert.ok(validateApiPath(path), `expected ${JSON.stringify(path)} to be rejected`);
  }
});

test("validateApiPath rejects literal and percent-encoded traversal", () => {
  for (const path of [
    "/../surveys",
    "/survey-definitions/./SV_123",
    "/survey-definitions/SV_123/../surveys",
    "/%2e%2e/surveys",
    "/%2E./surveys",
    "/survey-definitions/%2fSV_123",
    "/survey-definitions/%5cSV_123",
  ]) {
    assert.ok(validateApiPath(path), `expected ${JSON.stringify(path)} to be rejected`);
  }
});

type ApiCall = {
  endpoint: string;
  options: RequestInit;
  fallbackWriteScope?: WriteScope;
};

async function withApiTool(
  run: (client: Client, calls: ApiCall[]) => Promise<void>
): Promise<void> {
  const calls: ApiCall[] = [];
  const fakeQualtricsClient = {
    async makeRequest(
      endpoint: string,
      options: RequestInit,
      fallbackWriteScope?: WriteScope
    ) {
      calls.push({ endpoint, options, fallbackWriteScope });
      return { result: { ok: true } };
    },
  } as unknown as QualtricsClient;

  const server = new McpServer({ name: "api-tool-test", version: "1.0.0" });
  registerApiTools(server, fakeQualtricsClient);
  const client = new Client({ name: "api-tool-test-client", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    await run(client, calls);
  } finally {
    await client.close();
    await server.close();
  }
}

function resultText(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result)) {
    return "";
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const first: unknown = content[0];
  if (typeof first !== "object" || first === null) return "";
  const { type, text } = first as { type?: unknown; text?: unknown };
  return type === "text" && typeof text === "string" ? text : "";
}

test("qualtrics_api_request refuses DELETE without explicit confirmation", async () => {
  await withApiTool(async (client, calls) => {
    const result = await client.callTool({
      name: "qualtrics_api_request",
      arguments: { method: "DELETE", path: "/directories/DIR_123" },
    });

    assert.equal(result.isError, true);
    assert.match(resultText(result), /confirmDelete/);
    assert.equal(calls.length, 0);
  });
});

test("qualtrics_api_request sends a confirmed DELETE with safely encoded query values", async () => {
  await withApiTool(async (client, calls) => {
    const result = await client.callTool({
      name: "qualtrics_api_request",
      arguments: {
        method: "DELETE",
        path: "/directories/DIR_123",
        query: { tag: ["one two", "three"], active: true },
        confirmDelete: true,
      },
    });

    assert.notEqual(result.isError, true);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].endpoint,
      "/directories/DIR_123?tag=one+two&tag=three&active=true"
    );
    assert.equal(calls[0].options.method, "DELETE");
    assert.equal(calls[0].options.body, undefined);
    assert.equal(calls[0].fallbackWriteScope, "advanced");
  });
});

test("qualtrics_api_request rejects invalid paths and GET bodies before dispatch", async () => {
  await withApiTool(async (client, calls) => {
    const invalidPath = await client.callTool({
      name: "qualtrics_api_request",
      arguments: { method: "GET", path: "/%2e%2e/surveys" },
    });
    assert.equal(invalidPath.isError, true);
    assert.match(resultText(invalidPath), /Invalid Qualtrics API path/);

    const getWithBody = await client.callTool({
      name: "qualtrics_api_request",
      arguments: { method: "GET", path: "/surveys", body: { unexpected: true } },
    });
    assert.equal(getWithBody.isError, true);
    assert.match(resultText(getWithBody), /GET requests cannot include a body/);
    assert.equal(calls.length, 0);
  });
});
