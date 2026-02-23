export async function saveExportToFile(
  fileData: string,
  surveyId: string,
  format: string,
  saveToFile?: string,
  suffix?: string
): Promise<{ filePath: string; fileSizeBytes: number; fileSizeMB: string; wasAutoSaved: boolean }> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const os = await import("os");

  const fileSizeBytes = Buffer.byteLength(fileData, "utf8");
  const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
  const isLargeFile = fileSizeBytes > 100 * 1024;

  let filePath: string;
  if (saveToFile) {
    const filename = saveToFile.includes(".")
      ? saveToFile
      : `${saveToFile}.${format === "json" ? "json" : "csv"}`;
    filePath = path.isAbsolute(filename)
      ? filename
      : path.join(os.homedir(), "Downloads", filename);
  } else {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffixStr = suffix ? `_${suffix}` : "";
    const filename = `survey_${surveyId}${suffixStr}_${timestamp}.${format === "json" ? "json" : "csv"}`;
    filePath = path.join(os.homedir(), "Downloads", filename);
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, fileData, "utf8");

  return {
    filePath,
    fileSizeBytes,
    fileSizeMB,
    wasAutoSaved: isLargeFile && !saveToFile,
  };
}
