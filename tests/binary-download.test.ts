import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QualtricsConfig } from "../src/config/settings.js";
import { QualtricsClient } from "../src/services/qualtrics-client.js";
import { registerApiTools } from "../src/tools/api-tools.js";
import { registerResponseTools } from "../src/tools/response-tools.js";

const UPLOADED_FILE_PATH = "/surveys/SV_1/responses/R_1/uploaded-files/F_1";
const DOWNLOAD_ARGUMENTS = {
  surveyId: "SV_1",
  responseId: "R_1",
  fileId: "F_1",
};

function testConfig(timeout = 1_000): QualtricsConfig {
  return {
    qualtrics: {
      apiToken: "test-token",
      dataCenter: "test",
      baseUrl: "https://example.test/API/v3",
    },
    server: {
      readOnly: true,
      rateLimiting: { enabled: false, requestsPerMinute: 50 },
      timeout,
    },
  };
}

async function withTools(
  run: (client: Client, qualtricsClient: QualtricsClient) => Promise<void>
): Promise<void> {
  const config = testConfig();
  const qualtricsClient = new QualtricsClient(config);
  const server = new McpServer({ name: "binary-download-test", version: "1.0.0" });
  registerApiTools(server, qualtricsClient);
  registerResponseTools(server, qualtricsClient, config);
  const client = new Client({ name: "binary-download-client", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await run(client, qualtricsClient);
  } finally {
    await client.close();
    await server.close();
  }
}

async function withTemporaryHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "qualtrics-binary-download-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await run(home);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
}

function resultText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.equal(content[0]?.type, "text");
  assert.equal(typeof content[0].text, "string");
  return content[0].text!;
}

function streamedResponse(chunks: Uint8Array[], contentType?: string): Response {
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
  }, { highWaterMark: 0 }), {
    status: 200,
    headers: contentType ? { "Content-Type": contentType } : {},
  });
}

test("makeRequest rejects binary media types instead of decoding downloads as text", async (t) => {
  const client = new QualtricsClient(testConfig());
  for (const contentType of [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "application/octet-stream",
    "application/zip",
    "audio/mpeg",
    "video/mp4",
    "Application/PDF; charset=binary",
  ]) {
    await t.test(contentType, async (t) => {
      // Valid ASCII ensures this is a MIME guard, not merely a UTF-8 failure.
      t.mock.method(globalThis, "fetch", async () => new Response(
        Buffer.from("binary-container-header"),
        { headers: { "Content-Type": contentType } }
      ));
      await assert.rejects(client.makeRequest("/test-binary-resource"), /binary|download/i);
    });
  }
});

test("uploaded-files requests are rejected by the generic path regardless of MIME", async (t) => {
  for (const contentType of [undefined, "text/plain", "application/json", "application/pdf"]) {
    await t.test(contentType ?? "missing Content-Type", async (t) => {
      t.mock.method(globalThis, "fetch", async () => new Response(
        Buffer.from('{"valid":"UTF-8 is still an uploaded file"}'),
        { headers: contentType ? { "Content-Type": contentType } : {} }
      ));
      await withTools(async (client) => {
        const result = await client.callTool({
          name: "qualtrics_api_request",
          arguments: {
            method: "GET",
            path: UPLOADED_FILE_PATH,
            query: { download: true },
          },
        });
        assert.equal(result.isError, true);
        assert.match(resultText(result), /download_uploaded_file/);
        assert.doesNotMatch(resultText(result), /UTF-8 is still an uploaded file/);
      });
    });
  }
});

test("the uploaded-file GET guard preserves authorized DELETE JSON responses", async (t) => {
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response('{"meta":{"httpStatus":"200 - OK"}}', {
      headers: { "Content-Type": "application/json" },
    });
  });
  await withTools(async (client, qualtricsClient) => {
    qualtricsClient.writeScopes.add("surveys");
    const result = await client.callTool({
      name: "qualtrics_api_request",
      arguments: { method: "DELETE", path: UPLOADED_FILE_PATH, confirmDelete: true },
    });
    assert.notEqual(result.isError, true, resultText(result));
    assert.deepEqual(JSON.parse(resultText(result)).response, {
      meta: { httpStatus: "200 - OK" },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "DELETE");
  });
});

test("makeRequest never silently replaces invalid UTF-8 with missing or misleading MIME", async (t) => {
  for (const contentType of [undefined, "text/plain", "application/json"]) {
    await t.test(contentType ?? "missing Content-Type", async (t) => {
      // Otherwise-valid JSON containing a lone 0xff would previously succeed
      // after Response.text() silently replaced the original byte with U+FFFD.
      const payload = Buffer.concat([
        Buffer.from('{"value":"'),
        Buffer.from([0xff]),
        Buffer.from('"}'),
      ]);
      t.mock.method(globalThis, "fetch", async () => new Response(payload, {
        headers: contentType ? { "Content-Type": contentType } : {},
      }));
      await assert.rejects(
        new QualtricsClient(testConfig()).makeRequest("/test-text-resource"),
        /UTF-?8|binary|encoded data/i
      );
    });
  }
});

test("makeRequest preserves ordinary JSON, Unicode text, missing MIME and empty responses", async (t) => {
  const cases: Array<{
    name: string;
    body: BodyInit | null;
    contentType?: string;
    status?: number;
    expected: unknown;
  }> = [
    {
      name: "JSON",
      body: Buffer.from('{"result":{"text":"café 🦉"}}'),
      contentType: "application/json; charset=utf-8",
      expected: { result: { text: "café 🦉" } },
    },
    {
      name: "structured JSON suffix",
      body: Buffer.from('{"ok":true}'),
      contentType: "application/problem+json",
      expected: { ok: true },
    },
    {
      name: "Unicode text including a genuine replacement character",
      body: Buffer.from("café, 🦉, \ufffd\n"),
      contentType: "text/csv; charset=utf-8",
      expected: "café, 🦉, \ufffd\n",
    },
    {
      name: "missing MIME remains a string",
      body: Buffer.from('{"ok":true}'),
      expected: '{"ok":true}',
    },
    { name: "empty JSON", body: null, contentType: "application/json", expected: undefined },
    { name: "empty text", body: null, contentType: "text/plain", expected: undefined },
    { name: "no content", body: null, status: 204, expected: undefined },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      t.mock.method(globalThis, "fetch", async () => new Response(entry.body, {
        status: entry.status ?? 200,
        headers: entry.contentType ? { "Content-Type": entry.contentType } : {},
      }));
      assert.deepEqual(
        await new QualtricsClient(testConfig()).makeRequest("/test-text-resource"),
        entry.expected
      );
    });
  }
});

test("generic MCP API calls report binary guard errors rather than corrupted payloads", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff]),
    { headers: { "Content-Type": "image/png" } }
  ));
  await withTools(async (client) => {
    const result = await client.callTool({
      name: "qualtrics_api_request",
      arguments: { method: "GET", path: "/test-binary-resource" },
    });
    assert.equal(result.isError, true);
    assert.match(resultText(result), /binary|download/i);
    assert.doesNotMatch(resultText(result), /\ufffd/);
  });
});

test("download_uploaded_file saves small PDF, DOCX and PNG payloads byte-for-byte in read-only mode", async (t) => {
  const fixtures = [
    { filename: "response.pdf", mime: "application/pdf", header: Buffer.from("%PDF-1.7\n") },
    {
      filename: "response.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      header: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    },
    { filename: "response.png", mime: "image/png", header: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ];
  for (const fixture of fixtures) {
    await t.test(fixture.filename, async (t) => {
      const bytes = Buffer.concat([fixture.header, Buffer.from([0x00, 0xff, 0x80, 0xc3, 0x28, 0xfe])]);
      const calls: Array<{ input: string; init?: RequestInit }> = [];
      t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        calls.push({ input: String(input), init });
        return streamedResponse([bytes], fixture.mime);
      });
      await withTemporaryHome(async (home) => {
        await withTools(async (client, qualtricsClient) => {
          assert.equal(qualtricsClient.readOnly, true);
          assert.equal(qualtricsClient.writeScopes.size, 0);
          const result = await client.callTool({
            name: "download_uploaded_file",
            arguments: { ...DOWNLOAD_ARGUMENTS, saveToFile: fixture.filename },
          });
          assert.notEqual(result.isError, true, resultText(result));
          const body = JSON.parse(resultText(result));
          const target = join(home, "Downloads", fixture.filename);
          assert.deepEqual(body, {
            status: "completed",
            ...DOWNLOAD_ARGUMENTS,
            savedToFile: target,
            fileSize: bytes.length,
            fileSizeMB: (bytes.length / (1024 * 1024)).toFixed(2),
          });
          assert.deepEqual(await readFile(target), bytes);
          assert.equal(calls.length, 1);
          assert.equal(calls[0].input, `https://example.test/API/v3${UPLOADED_FILE_PATH}`);
          assert.equal(calls[0].init?.method ?? "GET", "GET");
          const headers = new Headers(calls[0].init?.headers);
          assert.equal(headers.get("X-API-TOKEN"), "test-token");
          assert.equal(headers.get("Accept"), "*/*");
          assert.equal(qualtricsClient.writeScopes.size, 0);
        });
      });
    });
  }
});

test("download_uploaded_file streams multiple binary chunks exactly, ignoring misleading MIME", async (t) => {
  // Every byte value is represented, including NUL and invalid UTF-8. The
  // subarray also checks that bytes outside a chunk's view cannot be written.
  const backing = Buffer.from([0xaa, 0x00, 0xff, 0x80, 0xbb]);
  const first = backing.subarray(1, 4);
  const second = Buffer.alloc(70 * 1024);
  for (let index = 0; index < second.length; index++) second[index] = index % 256;
  const third = Buffer.alloc(60 * 1024, 0xfe);
  const expected = Buffer.concat([first, second, third]);
  t.mock.method(globalThis, "fetch", async () => streamedResponse(
    [first, second, third],
    "text/plain"
  ));
  await withTemporaryHome(async (home) => {
    await withTools(async (client) => {
      const result = await client.callTool({
        name: "download_uploaded_file",
        arguments: { ...DOWNLOAD_ARGUMENTS, saveToFile: "all-bytes.custom" },
      });
      assert.notEqual(result.isError, true, resultText(result));
      const body = JSON.parse(resultText(result));
      assert.equal(body.savedToFile, join(home, "Downloads", "all-bytes.custom"));
      assert.equal(body.fileSize, expected.length);
      assert.equal(body.fileSizeMB, (expected.length / (1024 * 1024)).toFixed(2));
      assert.equal("data" in body, false);
      assert.deepEqual(await readFile(body.savedToFile), expected);
    });
  });
});

test("download_uploaded_file requires all identifiers and a nonempty filename", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => streamedResponse([]));
  await withTools(async (client) => {
    const tools = await client.listTools();
    const downloadTool = tools.tools.find((tool) => tool.name === "download_uploaded_file");
    assert.ok(downloadTool, "download_uploaded_file must be registered");
    assert.deepEqual(
      [...(downloadTool.inputSchema.required ?? [])].sort(),
      ["surveyId", "responseId", "fileId", "saveToFile"].sort()
    );
    for (const key of ["surveyId", "responseId", "fileId", "saveToFile"]) {
      const result = await client.callTool({
        name: "download_uploaded_file",
        arguments: { ...DOWNLOAD_ARGUMENTS, saveToFile: "test.pdf", [key]: "" },
      });
      assert.equal(result.isError, true, `empty ${key} must be rejected`);
    }
    const whitespaceName = await client.callTool({
      name: "download_uploaded_file",
      arguments: { ...DOWNLOAD_ARGUMENTS, saveToFile: "   " },
    });
    assert.equal(whitespaceName.isError, true);
  });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("empty uploaded files are still saved, and names without an extension get .bin", async (t) => {
  t.mock.method(globalThis, "fetch", async () => streamedResponse([]));
  await withTemporaryHome(async (home) => {
    await withTools(async (client) => {
      const result = await client.callTool({
        name: "download_uploaded_file",
        arguments: { ...DOWNLOAD_ARGUMENTS, saveToFile: " empty-upload " },
      });
      assert.notEqual(result.isError, true, resultText(result));
      const body = JSON.parse(resultText(result));
      assert.equal(body.savedToFile, join(home, "Downloads", "empty-upload.bin"));
      assert.equal(body.fileSize, 0);
      assert.equal(body.fileSizeMB, "0.00");
      assert.deepEqual(await readFile(body.savedToFile), Buffer.alloc(0));
    });
  });
});

test("download_uploaded_file rejects paths and traversal before fetching any data", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => streamedResponse([Buffer.from("data")]));
  await withTemporaryHome(async (home) => {
    await withTools(async (client) => {
      for (const filename of [
        "../outside.bin",
        join(home, "outside.bin"),
        "nested/outside.bin",
        "nested\\outside.bin",
        "bad\0name.bin",
        ".",
        "..",
      ]) {
        const result = await client.callTool({
          name: "download_uploaded_file",
          arguments: { ...DOWNLOAD_ARGUMENTS, saveToFile: filename },
        });
        assert.equal(result.isError, true, `expected ${JSON.stringify(filename)} to be rejected`);
        assert.match(resultText(result), /filename only/);
      }
    });
    assert.deepEqual(await readdir(home), []);
  });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("download_uploaded_file preserves existing files when exclusive creation fails", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => streamedResponse([Buffer.from("replacement")]));
  await withTemporaryHome(async (home) => {
    const downloads = join(home, "Downloads");
    const target = join(downloads, "existing.pdf");
    const original = Buffer.from([0x00, 0xff, 0x80, 0x42]);
    await mkdir(downloads);
    await writeFile(target, original);
    await withTools(async (client) => {
      const result = await client.callTool({
        name: "download_uploaded_file",
        arguments: { ...DOWNLOAD_ARGUMENTS, saveToFile: "existing.pdf" },
      });
      assert.equal(result.isError, true);
      assert.match(resultText(result), /EEXIST/);
    });
    assert.deepEqual(await readFile(target), original);
    assert.deepEqual(await readdir(downloads), ["existing.pdf"]);
  });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("interrupted uploaded-file downloads remove the partial file and preserve unrelated files", async (t) => {
  let sentFirstChunk = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sentFirstChunk) {
        sentFirstChunk = true;
        controller.enqueue(Buffer.from([0xff, 0x00, 0x80]));
      } else {
        controller.error(new Error("download interrupted"));
      }
    },
  }, { highWaterMark: 0 }), { headers: { "Content-Type": "application/pdf" } }));
  await withTemporaryHome(async (home) => {
    const downloads = join(home, "Downloads");
    await mkdir(downloads);
    await writeFile(join(downloads, "keep.txt"), "user-owned-data");
    await withTools(async (client) => {
      const result = await client.callTool({
        name: "download_uploaded_file",
        arguments: { ...DOWNLOAD_ARGUMENTS, saveToFile: "partial.pdf" },
      });
      assert.equal(result.isError, true);
      assert.match(resultText(result), /download interrupted/);
    });
    assert.equal(sentFirstChunk, true);
    await assert.rejects(stat(join(downloads, "partial.pdf")), /ENOENT/);
    assert.equal(await readFile(join(downloads, "keep.txt"), "utf8"), "user-owned-data");
    assert.deepEqual(await readdir(downloads), ["keep.txt"]);
  });
});

test("uploaded-file HTTP errors leave no saved error document", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(
    '{"meta":{"error":{"errorMessage":"file not found"}}}',
    { status: 404, statusText: "Not Found", headers: { "Content-Type": "application/json" } }
  ));
  await withTemporaryHome(async (home) => {
    await withTools(async (client) => {
      const result = await client.callTool({
        name: "download_uploaded_file",
        arguments: { ...DOWNLOAD_ARGUMENTS, saveToFile: "missing.pdf" },
      });
      assert.equal(result.isError, true);
      assert.match(resultText(result), /404.*file not found/);
    });
    await assert.rejects(stat(join(home, "Downloads", "missing.pdf")), /ENOENT/);
  });
});

test("ending uploaded-file consumption early cancels the raw response body", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array([0xff, 0x00, 0x80]));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 })));
  const iterator = new QualtricsClient(testConfig())
    .downloadUploadedFileChunks("SV_1", "R_1", "F_1")[Symbol.asyncIterator]();
  try {
    assert.deepEqual(await iterator.next(), {
      done: false,
      value: new Uint8Array([0xff, 0x00, 0x80]),
    });
  } finally {
    await iterator.return?.(undefined);
  }
  assert.equal(cancelled, true);
});

test("uploaded-file inactivity timeout does not run while the consumer processes a chunk", async (t) => {
  let index = 0;
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      pull(controller) {
        if (index < 2) controller.enqueue(new Uint8Array([0xff - index++]));
        else controller.close();
      },
    }, { highWaterMark: 0 });
    init?.signal?.addEventListener("abort", () => {
      streamController.error(new DOMException("aborted", "AbortError"));
    });
    return new Response(body);
  });
  const iterator = new QualtricsClient(testConfig(20))
    .downloadUploadedFileChunks("SV_1", "R_1", "F_1")[Symbol.asyncIterator]();
  try {
    assert.deepEqual(await iterator.next(), { done: false, value: new Uint8Array([0xff]) });
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.deepEqual(await iterator.next(), { done: false, value: new Uint8Array([0xfe]) });
    assert.deepEqual(await iterator.next(), { done: true, value: undefined });
  } finally {
    await iterator.return?.(undefined);
  }
});
