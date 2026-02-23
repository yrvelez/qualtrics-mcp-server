import { QualtricsClient } from "./qualtrics-client.js";

export class FlowApi {
  constructor(private client: QualtricsClient) {}

  async getFlow(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/flow`);
  }

  async updateFlow(surveyId: string, flowData: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/flow`, {
      method: "PUT",
      body: JSON.stringify(flowData),
    });
  }

  async updateFlowElement(surveyId: string, flowId: string, elementData: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${surveyId}/flow/${flowId}`, {
      method: "PUT",
      body: JSON.stringify(elementData),
    });
  }
}
