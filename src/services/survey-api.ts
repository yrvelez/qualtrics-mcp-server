import { QualtricsClient } from "./qualtrics-client.js";

export class SurveyApi {
  constructor(private client: QualtricsClient) {}

  async updateSurvey(surveyId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/surveys/${surveyId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteSurvey(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/surveys/${surveyId}`, {
      method: "DELETE",
    });
  }

  async activateSurvey(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/surveys/${surveyId}`, {
      method: "PUT",
      body: JSON.stringify({ isActive: true }),
    });
  }

  async deactivateSurvey(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/surveys/${surveyId}`, {
      method: "PUT",
      body: JSON.stringify({ isActive: false }),
    });
  }

  async listQuestions(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/questions`);
  }

  async getQuestion(surveyId: string, questionId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/questions/${questionId}`);
  }

  async createQuestion(surveyId: string, blockId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/questions?blockId=${blockId}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateQuestion(surveyId: string, questionId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/questions/${questionId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteQuestion(surveyId: string, questionId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/questions/${questionId}`, {
      method: "DELETE",
    });
  }

  async listBlocks(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/blocks`);
  }

  async getBlock(surveyId: string, blockId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/blocks/${blockId}`);
  }

  async createBlock(surveyId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/blocks`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateBlock(surveyId: string, blockId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/blocks/${blockId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteBlock(surveyId: string, blockId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/blocks/${blockId}`, {
      method: "DELETE",
    });
  }
}
