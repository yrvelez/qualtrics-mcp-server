import { QualtricsClient } from "./qualtrics-client.js";

export class UserApi {
  constructor(private client: QualtricsClient) {}

  async listUsers(offset?: number, username?: string): Promise<any> {
    const params = new URLSearchParams();
    if (offset !== undefined) params.set("offset", String(offset));
    if (username !== undefined) params.set("username", username);
    const qs = params.toString();
    return this.client.makeRequest(`/users${qs ? `?${qs}` : ""}`);
  }

  async getUser(userId: string): Promise<any> {
    return this.client.makeRequest(`/users/${encodeURIComponent(userId)}`);
  }
}

export function userNextOffset(nextPage: unknown): number | null {
  if (typeof nextPage !== "string" || nextPage.length === 0) return null;
  try {
    const value = new URL(nextPage, "https://qualtrics.invalid")
      .searchParams.get("offset");
    if (value === null) return null;
    const offset = Number(value);
    return Number.isInteger(offset) && offset >= 0 ? offset : null;
  } catch {
    return null;
  }
}
