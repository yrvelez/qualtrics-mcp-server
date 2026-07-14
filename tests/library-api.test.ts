import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QualtricsClient } from "../src/services/qualtrics-client.js";
import { LibraryApi } from "../src/services/library-api.js";
import { registerLibraryTools } from "../src/tools/library-tools.js";

type RequestCall = {
  endpoint: string;
  options?: RequestInit;
};

function libraryApiWithCalls(): { api: LibraryApi; calls: RequestCall[] } {
  const calls: RequestCall[] = [];
  const client = {
    async makeRequest(endpoint: string, options?: RequestInit) {
      calls.push({ endpoint, options });
      return { result: { id: "result-id", elements: [] } };
    },
  } as unknown as QualtricsClient;

  return { api: new LibraryApi(client), calls };
}

test("library survey-resource methods use the official encoded routes and offsets", async () => {
  const { api, calls } = libraryApiWithCalls();

  await api.listSurveyResources("LIB/team", "blocks", 20);
  await api.listSurveyResources("LIB/team", "questions");
  await api.listSurveyResources("LIB/team", "surveys", 0);

  assert.deepEqual(
    calls.map(({ endpoint, options }) => ({ endpoint, options })),
    [
      {
        endpoint: "/libraries/LIB%2Fteam/survey/blocks?offset=20",
        options: undefined,
      },
      {
        endpoint: "/libraries/LIB%2Fteam/survey/questions",
        options: undefined,
      },
      {
        endpoint: "/libraries/LIB%2Fteam/survey/surveys?offset=0",
        options: undefined,
      },
    ]
  );
});

test("library graphic methods preserve multipart bodies and encode delete paths", async () => {
  const { api, calls } = libraryApiWithCalls();
  const form = new FormData();
  form.set("name", "Experiment logo");
  form.set("fileUrl", "https://example.test/logo.png");
  form.set("contentType", "image/png");

  await api.uploadGraphic("LIB/team", form);
  await api.deleteGraphic("LIB/team", "GR/logo");

  assert.equal(calls[0].endpoint, "/libraries/LIB%2Fteam/graphics");
  assert.equal(calls[0].options?.method, "POST");
  assert.equal(calls[0].options?.body, form);
  assert.equal(calls[0].options?.headers, undefined);
  assert.equal(
    calls[1].endpoint,
    "/libraries/LIB%2Fteam/graphics/GR%2Flogo"
  );
  assert.equal(calls[1].options?.method, "DELETE");
});

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

async function withLibraryTools(
  run: (client: Client, calls: RequestCall[]) => Promise<void>
): Promise<void> {
  const calls: RequestCall[] = [];
  const fakeQualtricsClient = {
    async makeRequest(endpoint: string, options?: RequestInit) {
      calls.push({ endpoint, options });
      return { result: { id: "GR_test", elements: [] } };
    },
  } as unknown as QualtricsClient;

  const server = new McpServer({ name: "library-tool-test", version: "1.0.0" });
  registerLibraryTools(server, fakeQualtricsClient);
  const client = new Client({ name: "library-tool-test-client", version: "1.0.0" });
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

test("upload_library_graphic validates its source, URL scheme, and MIME signature before dispatch", async () => {
  await withLibraryTools(async (client, calls) => {
    const noSource = await client.callTool({
      name: "upload_library_graphic",
      arguments: {
        libraryId: "LIB_1",
        name: "No source",
        contentType: "image/png",
      },
    });
    assert.equal(noSource.isError, true);
    assert.match(resultText(noSource), /exactly one of fileUrl or contentBase64/);

    const bothSources = await client.callTool({
      name: "upload_library_graphic",
      arguments: {
        libraryId: "LIB_1",
        name: "Two sources",
        contentType: "image/png",
        fileUrl: "https://example.test/image.png",
        contentBase64: Buffer.from("not-used").toString("base64"),
      },
    });
    assert.equal(bothSources.isError, true);
    assert.match(resultText(bothSources), /exactly one of fileUrl or contentBase64/);

    const insecureUrl = await client.callTool({
      name: "upload_library_graphic",
      arguments: {
        libraryId: "LIB_1",
        name: "Insecure source",
        contentType: "image/png",
        fileUrl: "http://example.test/image.png",
      },
    });
    assert.equal(insecureUrl.isError, true);
    assert.match(resultText(insecureUrl), /must use HTTPS/);

    const signatureMismatch = await client.callTool({
      name: "upload_library_graphic",
      arguments: {
        libraryId: "LIB_1",
        name: "Wrong bytes",
        contentType: "image/png",
        contentBase64: Buffer.from("GIF89a").toString("base64"),
      },
    });
    assert.equal(signatureMismatch.isError, true);
    assert.match(resultText(signatureMismatch), /do not match image\/png/);

    assert.equal(calls.length, 0, "invalid uploads must not reach Qualtrics");
  });
});

test("upload_library_graphic builds a verified base64 multipart upload", async () => {
  await withLibraryTools(async (client, calls) => {
    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).toString("base64");

    const result = await client.callTool({
      name: "upload_library_graphic",
      arguments: {
        libraryId: "LIB_1",
        name: "Study logo",
        folder: "Experiments",
        contentType: "image/png",
        contentBase64: pngSignature,
        filename: "study-logo.png",
      },
    });

    assert.notEqual(result.isError, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, "/libraries/LIB_1/graphics");
    assert.equal(calls[0].options?.method, "POST");
    assert.ok(calls[0].options?.body instanceof FormData);
    assert.equal(calls[0].options.body.get("name"), "Study logo");
    assert.equal(calls[0].options.body.get("folder"), "Experiments");

    const file = calls[0].options.body.get("file");
    assert.ok(file instanceof Blob);
    assert.equal(file.type, "image/png");
    assert.equal((file as Blob & { name?: string }).name, "study-logo.png");
    assert.deepEqual(
      Buffer.from(await file.arrayBuffer()),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  });
});

test("delete_library_graphic requires explicit confirmation before dispatch", async () => {
  await withLibraryTools(async (client, calls) => {
    const refused = await client.callTool({
      name: "delete_library_graphic",
      arguments: {
        libraryId: "LIB_1",
        graphicId: "GR_1",
        confirmDelete: false,
      },
    });
    assert.equal(refused.isError, true);
    assert.match(resultText(refused), /confirmDelete/);
    assert.equal(calls.length, 0);

    const confirmed = await client.callTool({
      name: "delete_library_graphic",
      arguments: {
        libraryId: "LIB_1",
        graphicId: "GR_1",
        confirmDelete: true,
      },
    });
    assert.notEqual(confirmed.isError, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, "/libraries/LIB_1/graphics/GR_1");
    assert.equal(calls[0].options?.method, "DELETE");
  });
});
