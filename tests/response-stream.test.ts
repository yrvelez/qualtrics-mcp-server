import assert from "node:assert/strict";
import test from "node:test";
import type { QualtricsConfig } from "../src/config/settings.js";
import { QualtricsClient } from "../src/services/qualtrics-client.js";

function downloadClient(timeout: number): QualtricsClient {
  const config: QualtricsConfig = {
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
  return new QualtricsClient(config);
}

test("response download timeout measures inactivity, not total consumer time", async (t) => {
  let index = 0;
  t.mock.method(globalThis, "fetch", async (_input, init) => {
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      pull(controller) {
        if (index < 2) controller.enqueue(new Uint8Array([index++ + 1]));
        else controller.close();
      },
    }, { highWaterMark: 0 });
    init?.signal?.addEventListener("abort", () => {
      try {
        streamController.error(new DOMException("aborted", "AbortError"));
      } catch {
        // The stream may already be closed after the final chunk.
      }
    });
    return new Response(body, { status: 200 });
  });

  const iterator = downloadClient(20)
    .downloadResponseExportChunks("SV_1", "FILE_1")[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), {
    done: false,
    value: new Uint8Array([1]),
  });
  // Deliberately exceed the 20ms request timeout while the consumer owns the
  // first chunk. A total-transfer timer would abort here; an idle-read timer
  // must not.
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.deepEqual(await iterator.next(), {
    done: false,
    value: new Uint8Array([2]),
  });
  assert.deepEqual(await iterator.next(), { done: true, value: undefined });
});

test("ending response consumption early cancels the response body", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: 200 });
  });

  const iterator = downloadClient(1_000)
    .downloadResponseExportChunks("SV_1", "FILE_1")[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.return?.();
  assert.equal(cancelled, true);
});
