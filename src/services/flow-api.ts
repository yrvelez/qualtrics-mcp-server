import { QualtricsClient } from "./qualtrics-client.js";

export class FlowApi {
  constructor(private client: QualtricsClient) {}

  async getFlow(surveyId: string): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${encodeURIComponent(surveyId)}/flow`);
  }

  async updateFlow(surveyId: string, flowData: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${encodeURIComponent(surveyId)}/flow`, {
      method: "PUT",
      body: JSON.stringify(flowData),
    });
  }

  async updateFlowElement(surveyId: string, flowId: string, childElements: Array<Record<string, any>>): Promise<any> {
    return this.client.makeRequest(`/survey-definitions/${encodeURIComponent(surveyId)}/flow/${encodeURIComponent(flowId)}`, {
      method: "PUT",
      // The official flow-element endpoint accepts an array, not a single
      // element object. Higher-level element patching uses the full-flow PUT.
      body: JSON.stringify(childElements),
    });
  }
}
