import { QualtricsClient } from "./qualtrics-client.js";

export class ResponseApi {
  constructor(private client: QualtricsClient) {}

  async getResponse(surveyId: string, responseId: string): Promise<any> {
    return this.client.makeRequest(`/surveys/${encodeURIComponent(surveyId)}/responses/${encodeURIComponent(responseId)}`);
  }

  async createResponse(surveyId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/surveys/${encodeURIComponent(surveyId)}/responses`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateResponseEmbeddedData(
    surveyId: string,
    responseId: string,
    embeddedData: Record<string, string>,
    resetRecordedDate = false
  ): Promise<any> {
    return this.client.makeRequest(`/surveys/${encodeURIComponent(surveyId)}/update-responses`, {
      method: "POST",
      body: JSON.stringify({
        updates: [{ responseId, resetRecordedDate, embeddedData }],
        removeEdits: false,
        ignoreMissingResponses: false,
      }),
    });
  }

  async deleteResponse(surveyId: string, responseId: string): Promise<any> {
    return this.client.makeRequest(`/surveys/${encodeURIComponent(surveyId)}/responses/${encodeURIComponent(responseId)}`, {
      method: "DELETE",
    });
  }
}
