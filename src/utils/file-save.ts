import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const AUTO_SAVE_THRESHOLD_BYTES = 100 * 1024;

export interface SavedExport {
  filePath: string;
  fileSizeBytes: number;
  fileSizeMB: string;
  wasAutoSaved: boolean;
}

export interface ConsumedExport {
  data?: string;
  savedToFile?: string;
  fileSizeBytes: number;
  fileSizeMB: string;
  wasAutoSaved: boolean;
}

function safeGeneratedPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^\.+/, "") || "export";
}

function exportExtension(format: string): string {
  return format === "json" ? "json" : "csv";
}

function exportFilePath(
  surveyId: string,
  format: string,
  saveToFile?: string,
  suffix?: string
): string {
  const downloadsDirectory = path.join(os.homedir(), "Downloads");
  if (saveToFile) {
    if (
      saveToFile === "." ||
      saveToFile === ".." ||
      saveToFile.includes("/") ||
      saveToFile.includes("\\") ||
      saveToFile.includes("\0") ||
      path.isAbsolute(saveToFile)
    ) {
      throw new Error(
        "saveToFile must be a filename only; paths, traversal, and directory separators are not allowed"
      );
    }
    const filename = saveToFile.includes(".")
      ? saveToFile
      : `${saveToFile}.${exportExtension(format)}`;
    return path.join(downloadsDirectory, filename);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffixStr = suffix ? `_${safeGeneratedPart(suffix)}` : "";
  const filename =
    `survey_${safeGeneratedPart(surveyId)}${suffixStr}_${timestamp}.` +
    exportExtension(format);
  return path.join(downloadsDirectory, filename);
}

/** Retry a FileHandle-style writer until the complete buffer is persisted. */
export async function writeBufferFully(
  write: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: null
  ) => Promise<{ bytesWritten: number }>,
  buffer: Buffer
): Promise<void> {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesWritten } = await write(
      buffer,
      offset,
      buffer.byteLength - offset,
      null
    );
    if (bytesWritten <= 0 || bytesWritten > buffer.byteLength - offset) {
      throw new Error("Could not make progress while writing the response export file.");
    }
    offset += bytesWritten;
  }
}

/**
 * Consume a response export without retaining an unbounded body in memory.
 * Data stays in RAM only up to the MCP-safe threshold, then the already-read
 * prefix and every later chunk are streamed into a collision-safe local file.
 */
export async function consumeExportDownload(
  chunks: AsyncIterable<Uint8Array>,
  surveyId: string,
  format: string,
  saveToFile?: string,
  suffix?: string,
  forceToFile = false
): Promise<ConsumedExport> {
  // Validate an explicitly requested filename before starting the download.
  const requestedPath = saveToFile
    ? exportFilePath(surveyId, format, saveToFile, suffix)
    : undefined;
  const buffered: Buffer[] = [];
  let fileHandle: fs.FileHandle | undefined;
  let filePath: string | undefined;
  let fileSizeBytes = 0;

  async function beginFile(): Promise<void> {
    if (fileHandle) return;
    const targetPath = requestedPath ??
      exportFilePath(surveyId, format, undefined, suffix);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    // Never overwrite an existing user file.
    const openedFile = await fs.open(targetPath, "wx");
    // Record cleanup ownership only after the exclusive create succeeds. If
    // open() reports EEXIST, the pre-existing user file must never be unlinked.
    filePath = targetPath;
    fileHandle = openedFile;
    for (const prefix of buffered) {
      await writeBufferFully(
        (data, offset, length, position) =>
          fileHandle!.write(data, offset, length, position),
        prefix
      );
    }
    buffered.length = 0;
  }

  try {
    if (saveToFile || forceToFile) await beginFile();

    for await (const value of chunks) {
      const chunk = Buffer.from(value);
      fileSizeBytes += chunk.byteLength;
      if (!fileHandle && fileSizeBytes > AUTO_SAVE_THRESHOLD_BYTES) {
        await beginFile();
      }
      if (fileHandle) {
        await writeBufferFully(
          (data, offset, length, position) =>
            fileHandle!.write(data, offset, length, position),
          chunk
        );
      }
      else buffered.push(chunk);
    }

    await fileHandle?.close();
    fileHandle = undefined;
  } catch (error) {
    await fileHandle?.close().catch(() => undefined);
    if (filePath) await fs.unlink(filePath).catch(() => undefined);
    throw error;
  }

  const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
  if (filePath) {
    return {
      savedToFile: filePath,
      fileSizeBytes,
      fileSizeMB,
      wasAutoSaved: !saveToFile && fileSizeBytes > AUTO_SAVE_THRESHOLD_BYTES,
    };
  }
  return {
    data: Buffer.concat(buffered).toString("utf8"),
    fileSizeBytes,
    fileSizeMB,
    wasAutoSaved: false,
  };
}

/** Backwards-compatible helper for callers that already hold a small string. */
export async function saveExportToFile(
  fileData: string,
  surveyId: string,
  format: string,
  saveToFile?: string,
  suffix?: string
): Promise<SavedExport> {
  async function* content(): AsyncGenerator<Uint8Array> {
    yield Buffer.from(fileData, "utf8");
  }
  const consumed = await consumeExportDownload(
    content(),
    surveyId,
    format,
    saveToFile,
    suffix,
    true
  );
  return {
    filePath: consumed.savedToFile!,
    fileSizeBytes: consumed.fileSizeBytes,
    fileSizeMB: consumed.fileSizeMB,
    wasAutoSaved: consumed.wasAutoSaved,
  };
}
