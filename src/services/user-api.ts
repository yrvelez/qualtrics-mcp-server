import { QualtricsClient } from "./qualtrics-client.js";

export class UserApi {
  constructor(private client: QualtricsClient) {}

  async listUsers(offset?: number, limit?: number): Promise<any> {
    const params = new URLSearchParams();
    if (offset !== undefined) params.set("offset", String(offset));
    if (limit !== undefined) params.set("limit", String(limit));
    const qs = params.toString();
    return this.client.makeRequest(`/users${qs ? `?${qs}` : ""}`);
  }

  async getUser(userId: string): Promise<any> {
    return this.client.makeRequest(`/users/${userId}`);
  }
}
