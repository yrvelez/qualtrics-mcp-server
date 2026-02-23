import { QualtricsClient } from "./qualtrics-client.js";

export class DistributionApi {
  constructor(private client: QualtricsClient) {}

  async listDistributions(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/distributions?surveyId=${surveyId}`);
  }

  async getDistribution(distributionId: string, surveyId: string): Promise<any> {
    return this.client.makeRequest(`/distributions/${distributionId}?surveyId=${surveyId}`);
  }

  async createDistribution(data: Record<string, any>): Promise<any> {
    return this.client.makeRequest("/distributions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteDistribution(distributionId: string): Promise<any> {
    return this.client.makeRequest(`/distributions/${distributionId}`, {
      method: "DELETE",
    });
  }

  async generateDistributionLinks(distributionId: string, surveyId: string): Promise<any> {
    return this.client.makeRequest(`/distributions/${distributionId}/links?surveyId=${surveyId}`);
  }

  async createReminder(distributionId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/distributions/${distributionId}/reminders`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createThankYou(distributionId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/distributions/${distributionId}/thankyous`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}
