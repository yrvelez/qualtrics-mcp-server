import { QualtricsClient } from "./qualtrics-client.js";

export class ResponseApi {
  constructor(private client: QualtricsClient) {}

  async getResponse(surveyId: string, responseId: string): Promise<any> {
    return this.client.makeRequest(`/surveys/${surveyId}/responses/${responseId}`);
  }

  async createResponse(surveyId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/surveys/${surveyId}/responses`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateResponse(surveyId: string, responseId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/surveys/${surveyId}/responses/${responseId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteResponse(surveyId: string, responseId: string): Promise<any> {
    return this.client.makeRequest(`/surveys/${surveyId}/responses/${responseId}`, {
      method: "DELETE",
    });
  }
}
