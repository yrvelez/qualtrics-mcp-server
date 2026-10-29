import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig, type QualtricsConfig } from "../src/config/settings.js";
import { QualtricsClient } from "../src/services/qualtrics-client.js";
import { createQualtricsServer } from "../src/server.js";

const ENV_KEYS = [
  "QUALTRICS_API_TOKEN",
  "QUALTRICS_DATA_CENTER",
  "QUALTRICS_READ_ONLY",
  "QUALTRICS_WRITE_SCOPES",
  "QUALTRICS_WRITE_SCOPES_LOCKED",
] as const;

async function withEnv<T>(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { QUALTRICS_API_TOKEN: "test-token", QUALTRICS_DATA_CENTER: "test", ...env });
  try {
    return await run();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function clientConfig(server: Partial<QualtricsConfig["server"]>): QualtricsConfig {
  return {
    qualtrics: { apiToken: "t", dataCenter: "test", baseUrl: "https://example.test/API/v3" },
    server: {
      readOnly: true,
      rateLimiting: { enabled: false, requestsPerMinute: 50 },
      timeout: 1_000,
      ...server,
    },
  };
}

test("QUALTRICS_WRITE_SCOPES accepts a comma list, ignoring case, spaces and duplicates", async () => {
  await withEnv({ QUALTRICS_WRITE_SCOPES: " questionsandblocks, surveyDesign ,surveyDesign," }, async () => {
    const config = await loadConfig();
    assert.deepEqual(config.server.writeScopes, ["questionsAndBlocks", "surveyDesign"]);
    assert.equal(config.server.writeScopesLocked, false);
  });
  await withEnv({ QUALTRICS_WRITE_SCOPES: "  , " }, async () => {
    assert.equal((await loadConfig()).server.writeScopes, undefined);
  });
  await withEnv({ QUALTRICS_WRITE_SCOPES_LOCKED: "true" }, async () => {
    assert.equal((await loadConfig()).server.writeScopesLocked, true);
  });
});

test("an unknown scope name fails startup instead of being ignored", async () => {
  await withEnv({ QUALTRICS_WRITE_SCOPES: "questionsAndBlocks,surveyDesing" }, async () => {
    await assert.rejects(loadConfig(), /unknown scope\(s\): surveyDesing\. Valid scopes: .*surveyDesign/);
  });
});

test("startup scopes come from QUALTRICS_WRITE_SCOPES and can still be changed when unlocked", () => {
  const client = new QualtricsClient(clientConfig({ writeScopes: ["questionsAndBlocks"] }));
  assert.deepEqual([...client.writeScopes], ["questionsAndBlocks"]);
  assert.equal(client.lockedScopes, null);
  client.writeScopes = new Set(["surveys"]);
  assert.deepEqual([...client.writeScopes], ["surveys"]);
});

test("a locked client can never hold a scope outside the configured list", () => {
  const client = new QualtricsClient(
    clientConfig({ writeScopes: ["questionsAndBlocks", "surveyDesign"], writeScopesLocked: true })
  );
  assert.deepEqual(client.lockedScopes, ["surveyDesign", "questionsAndBlocks"]);
  assert.equal(client.isScopeAllowed("surveys"), false);

  assert.throws(() => {
    client.writeScopes = new Set(["questionsAndBlocks", "surveys"]);
  }, /not permitted by server configuration: surveys/);
  assert.deepEqual([...client.writeScopes].sort(), ["questionsAndBlocks", "surveyDesign"]);

  client.writeScopes = new Set(["questionsAndBlocks"]);
  client.readOnly = true;
  assert.equal(client.readOnly, true);
  client.readOnly = false;
  assert.deepEqual([...client.writeScopes].sort(), ["questionsAndBlocks", "surveyDesign"]);
});

test("locking without a list is permanently read-only", () => {
  const client = new QualtricsClient(clientConfig({ writeScopesLocked: true }));
  assert.deepEqual(client.lockedScopes, []);
  client.readOnly = false;
  assert.equal(client.readOnly, true);
  assert.throws(() => {
    client.writeScopes = new Set(["questionsAndBlocks"]);
  }, /not permitted/);
});

test("locked writes outside the list are rejected by the request scope check", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "content-type": "application/json" } })
  );
  const client = new QualtricsClient(
    clientConfig({ writeScopes: ["questionsAndBlocks", "surveyDesign"], writeScopesLocked: true })
  );
  client.readOnly = false;
  await client.makeRequest("/survey-definitions/SV_1/questions", { method: "POST", body: "{}" });
  await assert.rejects(
    client.makeRequest("/surveys/SV_1", { method: "DELETE" }),
    /Scope "surveys" is not enabled/
  );
});

async function connect(env: Parameters<typeof withEnv>[0]) {
  return withEnv(env, async () => {
    const server = await createQualtricsServer();
    const client = new Client({ name: "write-scopes-test", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, close: async () => { await client.close(); await server.close(); } };
  });
}

const textOf = (result: unknown) =>
  ((result as { content: Array<{ text: string }> }).content[0] as { text: string }).text;

test("a locked server tells the agent its limits and refuses escalation over MCP", async () => {
  const { client, close } = await connect({
    QUALTRICS_WRITE_SCOPES: "questionsAndBlocks,surveyDesign",
    QUALTRICS_WRITE_SCOPES_LOCKED: "true",
  });
  try {
    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /LOCKED/);
    assert.match(instructions, /"questionsAndBlocks"/);
    assert.doesNotMatch(instructions, /"surveys" \[HIGH/);

    const refused = await client.callTool({ name: "set_write_scopes", arguments: { scopes: ["questionsAndBlocks", "surveys"] } });
    assert.equal(refused.isError, true);
    assert.match(textOf(refused), /Refused: scope\(s\) surveys/);

    const narrowed = await client.callTool({ name: "set_write_scopes", arguments: { scopes: ["questionsAndBlocks"] } });
    assert.notEqual(narrowed.isError, true);
    assert.match(textOf(narrowed), /questionsAndBlocks/);
    assert.doesNotMatch(textOf(narrowed), /✓ surveyDesign/);

    const regranted = await client.callTool({ name: "set_read_only_mode", arguments: { enabled: false } });
    assert.match(textOf(regranted), /configured limit/);
    assert.doesNotMatch(textOf(regranted), /✓ surveys /);
    assert.doesNotMatch(textOf(regranted), /All write scopes are now enabled/);
  } finally {
    await close();
  }
});

test("an unlocked list is only the starting point", async () => {
  const { client, close } = await connect({ QUALTRICS_WRITE_SCOPES: "questionsAndBlocks" });
  try {
    assert.match(client.getInstructions() ?? "", /started with some write scopes already enabled/);
    const result = await client.callTool({ name: "set_write_scopes", arguments: { scopes: ["questionsAndBlocks", "surveyDesign"] } });
    assert.notEqual(result.isError, true);
  } finally {
    await close();
  }
});
