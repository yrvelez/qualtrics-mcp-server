import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consumeExportDownload,
  saveExportToFile,
  writeBufferFully,
} from "../src/utils/file-save.js";

test("response export filenames cannot escape the fixed Downloads directory", async () => {
  for (const filename of [
    "../outside.csv",
    "/tmp/outside.csv",
    "nested/outside.csv",
    "nested\\outside.csv",
    ".",
    "..",
  ]) {
    await assert.rejects(
      saveExportToFile("data", "SV_1", "csv", filename),
      /filename only/
    );
  }
});

test("an existing Downloads file is never removed when exclusive creation fails", async () => {
  const home = await mkdtemp(join(tmpdir(), "qualtrics-export-test-"));
  const downloads = join(home, "Downloads");
  const target = join(downloads, "existing.csv");
  await mkdir(downloads, { recursive: true });
  await writeFile(target, "user-owned-data", "utf8");

  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await assert.rejects(
      saveExportToFile("replacement", "SV_1", "csv", "existing.csv"),
      /EEXIST/
    );
    assert.equal(await readFile(target, "utf8"), "user-owned-data");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("small streamed exports stay in memory with exact byte order", async () => {
  async function* chunks(): AsyncGenerator<Uint8Array> {
    yield Buffer.from("first,");
    yield Buffer.from("second\n");
  }

  const result = await consumeExportDownload(chunks(), "SV_1", "csv");
  assert.equal(result.data, "first,second\n");
  assert.equal(result.savedToFile, undefined);
  assert.equal(result.fileSizeBytes, 13);
  assert.equal(result.wasAutoSaved, false);
});

test("large multi-chunk exports auto-stream to disk with exact bytes", async () => {
  const home = await mkdtemp(join(tmpdir(), "qualtrics-export-stream-test-"));
  const first = Buffer.alloc(70 * 1024, 0x61);
  const second = Buffer.alloc(50 * 1024, 0x62);
  async function* chunks(): AsyncGenerator<Uint8Array> {
    yield first;
    yield second;
  }

  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const result = await consumeExportDownload(chunks(), "SV_1", "csv");
    assert.ok(result.savedToFile);
    assert.equal(result.wasAutoSaved, true);
    assert.equal(result.fileSizeBytes, first.length + second.length);
    assert.deepEqual(
      await readFile(result.savedToFile),
      Buffer.concat([first, second])
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("a failed stream removes only the partial file it created", async () => {
  const home = await mkdtemp(join(tmpdir(), "qualtrics-export-partial-test-"));
  const target = join(home, "Downloads", "partial.csv");
  async function* failingChunks(): AsyncGenerator<Uint8Array> {
    yield Buffer.from("partial-data");
    throw new Error("download interrupted");
  }

  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await assert.rejects(
      consumeExportDownload(
        failingChunks(),
        "SV_1",
        "csv",
        "partial.csv"
      ),
      /download interrupted/
    );
    await assert.rejects(stat(target), /ENOENT/);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("export writes retry short filesystem writes until every byte is persisted", async () => {
  const input = Buffer.from("complete-response-export");
  const pieces: Buffer[] = [];
  let calls = 0;

  await writeBufferFully(async (buffer, offset, length) => {
    calls++;
    const bytesWritten = Math.min(3, length);
    pieces.push(Buffer.from(buffer.subarray(offset, offset + bytesWritten)));
    return { bytesWritten };
  }, input);

  assert.ok(calls > 1);
  assert.deepEqual(Buffer.concat(pieces), input);

  await assert.rejects(
    writeBufferFully(async () => ({ bytesWritten: 0 }), input),
    /Could not make progress/
  );
});
