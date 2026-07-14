import { QualtricsClient } from "./qualtrics-client.js";

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export class LibraryApi {
  constructor(private client: QualtricsClient) {}

  listLibraries(offset?: number): Promise<any> {
    return this.client.makeRequest(`/libraries${queryString({ offset })}`);
  }

  listSurveyResources(
    libraryId: string,
    resource: "blocks" | "questions" | "surveys",
    offset?: number
  ): Promise<any> {
    return this.client.makeRequest(
      `/libraries/${encodeURIComponent(libraryId)}/survey/${resource}${queryString({ offset })}`
    );
  }

  listMessages(libraryId: string, category?: string, offset?: number): Promise<any> {
    const query = queryString({ category, offset });
    return this.client.makeRequest(`/libraries/${encodeURIComponent(libraryId)}/messages${query}`);
  }

  getMessage(libraryId: string, messageId: string): Promise<any> {
    return this.client.makeRequest(
      `/libraries/${encodeURIComponent(libraryId)}/messages/${encodeURIComponent(messageId)}`
    );
  }

  createMessage(libraryId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/libraries/${encodeURIComponent(libraryId)}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  updateMessage(
    libraryId: string,
    messageId: string,
    data: Record<string, any>
  ): Promise<any> {
    return this.client.makeRequest(
      `/libraries/${encodeURIComponent(libraryId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "PUT", body: JSON.stringify(data) }
    );
  }

  deleteMessage(libraryId: string, messageId: string): Promise<any> {
    return this.client.makeRequest(
      `/libraries/${encodeURIComponent(libraryId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE" }
    );
  }

  uploadGraphic(libraryId: string, form: FormData): Promise<any> {
    return this.client.makeRequest(
      `/libraries/${encodeURIComponent(libraryId)}/graphics`,
      { method: "POST", body: form }
    );
  }

  deleteGraphic(libraryId: string, graphicId: string): Promise<any> {
    return this.client.makeRequest(
      `/libraries/${encodeURIComponent(libraryId)}/graphics/${encodeURIComponent(graphicId)}`,
      { method: "DELETE" }
    );
  }
}
