import { QualtricsClient } from "./qualtrics-client.js";

export type SurveyImportFormat = "qsf" | "txt" | "docx";

const MIME_TYPES: Record<SurveyImportFormat, string> = {
  qsf: "application/vnd.qualtrics.survey.qsf",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const FILE_EXTENSIONS: Record<SurveyImportFormat, string> = {
  qsf: "qsf",
  txt: "txt",
  docx: "docx",
};

export class SurveyImportApi {
  constructor(private client: QualtricsClient) {}

  async copySurvey(
    sourceSurveyId: string,
    name: string,
    destinationOwnerId?: string
  ): Promise<any> {
    const form = new FormData();
    form.set("name", name);
    const headers: Record<string, string> = {
      "X-COPY-SOURCE": sourceSurveyId,
    };
    if (destinationOwnerId) {
      headers["X-COPY-DESTINATION-OWNER"] = destinationOwnerId;
    }

    return this.client.makeRequest("/surveys", {
      method: "POST",
      headers,
      body: form,
    });
  }

  async importContent(
    name: string,
    format: SurveyImportFormat,
    content: Blob,
    filename?: string
  ): Promise<any> {
    const form = new FormData();
    form.set("name", name);
    form.set(
      "file",
      content,
      filename ?? `${name.replace(/[^A-Za-z0-9_-]+/g, "_")}.${FILE_EXTENSIONS[format]}`
    );

    return this.client.makeRequest("/surveys", {
      method: "POST",
      body: form,
    });
  }

  async importFromUrl(
    name: string,
    format: SurveyImportFormat,
    fileUrl: string
  ): Promise<any> {
    const form = new FormData();
    form.set("name", name);
    form.set("contentType", MIME_TYPES[format]);
    form.set("fileUrl", fileUrl);

    return this.client.makeRequest("/surveys", {
      method: "POST",
      body: form,
    });
  }

  static mimeType(format: SurveyImportFormat): string {
    return MIME_TYPES[format];
  }
}
