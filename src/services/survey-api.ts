import { QualtricsClient } from "./qualtrics-client.js";

function segment(value: string): string {
  return encodeURIComponent(value);
}

export class SurveyApi {
  constructor(private client: QualtricsClient) {}

  async updateSurvey(surveyId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/surveys/${segment(surveyId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteSurvey(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/surveys/${segment(surveyId)}`, {
      method: "DELETE",
    });
  }

  async activateSurvey(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/surveys/${segment(surveyId)}`, {
      method: "PUT",
      body: JSON.stringify({ isActive: true }),
    });
  }

  async deactivateSurvey(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/surveys/${segment(surveyId)}`, {
      method: "PUT",
      body: JSON.stringify({ isActive: false }),
    });
  }

  async listQuestions(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${segment(surveyId)}/questions`);
  }

  async getQuestion(surveyId: string, questionId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${segment(surveyId)}/questions/${segment(questionId)}`);
  }

  async createQuestion(surveyId: string, blockId: string, data: Record<string, any>): Promise<any> {
    const params = new URLSearchParams({ blockId });
    return this.client.makeRequest(`/survey-definitions/${segment(surveyId)}/questions?${params.toString()}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateQuestion(surveyId: string, questionId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${segment(surveyId)}/questions/${segment(questionId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteQuestion(surveyId: string, questionId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${segment(surveyId)}/questions/${segment(questionId)}`, {
      method: "DELETE",
    });
  }

  async listBlocks(surveyId: string): Promise<any> {
    const result: any = await this.client.makeRequest(`/survey-definitions/${segment(surveyId)}`);
    return { result: result.result.Blocks };
  }

  async getBlock(surveyId: string, blockId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${segment(surveyId)}/blocks/${segment(blockId)}`);
  }

  async createBlock(surveyId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${segment(surveyId)}/blocks`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateBlock(surveyId: string, blockId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${segment(surveyId)}/blocks/${segment(blockId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteBlock(surveyId: string, blockId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${segment(surveyId)}/blocks/${segment(blockId)}`, {
      method: "DELETE",
    });
  }
}
