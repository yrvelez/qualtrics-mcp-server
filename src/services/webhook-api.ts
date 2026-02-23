import { QualtricsClient } from "./qualtrics-client.js";

export class WebhookApi {
  constructor(private client: QualtricsClient) {}

  async listWebhooks(): Promise<any> {
    return this.client.makeRequest("/eventsubscriptions");
  }

  async createWebhook(data: Record<string, any>): Promise<any> {
    return this.client.makeRequest("/eventsubscriptions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteWebhook(subscriptionId: string): Promise<any> {
    return this.client.makeRequest(`/eventsubscriptions/${subscriptionId}`, {
      method: "DELETE",
    });
  }
}
