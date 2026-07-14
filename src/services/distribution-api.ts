import { QualtricsClient } from "./qualtrics-client.js";

export interface DistributionListOptions {
  mailingListId?: string;
  distributionRequestType?: string;
  sendStartDate?: string;
  sendEndDate?: string;
  pageSize?: number;
  skipToken?: string;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function distributionNextSkipToken(nextPage: unknown): string | null {
  if (typeof nextPage !== "string" || nextPage.length === 0) return null;
  try {
    const parsed = new URL(nextPage, "https://qualtrics.invalid");
    return parsed.searchParams.get("skipToken") ?? nextPage;
  } catch {
    return nextPage;
  }
}

export class DistributionApi {
  constructor(private client: QualtricsClient) {}

  async listDistributions(
    surveyId: string,
    options: DistributionListOptions = {}
  ): Promise<any> {
    const params = new URLSearchParams({
      surveyId,
      useNewPaginationScheme: "true",
    });
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return this.client.makeRequest(`/distributions?${params.toString()}`);
  }

  async getDistribution(distributionId: string, surveyId: string): Promise<any> {
    const params = new URLSearchParams({ surveyId });
    return this.client.makeRequest(
      `/distributions/${segment(distributionId)}?${params.toString()}`
    );
  }

  async getDistributionHistory(
    distributionId: string,
    surveyId: string,
    skipToken?: string
  ): Promise<any> {
    const params = new URLSearchParams({ surveyId });
    if (skipToken !== undefined) params.set("skipToken", skipToken);
    return this.client.makeRequest(
      `/distributions/${segment(distributionId)}/history?${params.toString()}`
    );
  }

  async createDistribution(data: Record<string, any>): Promise<any> {
    return this.client.makeRequest("/distributions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteDistribution(distributionId: string): Promise<any> {
    return this.client.makeRequest(`/distributions/${segment(distributionId)}`, {
      method: "DELETE",
    });
  }

  async generateDistributionLinks(
    distributionId: string,
    surveyId: string,
    skipToken?: string
  ): Promise<any> {
    const params = new URLSearchParams({ surveyId });
    if (skipToken !== undefined) params.set("skipToken", skipToken);
    const endpoint = `/distributions/${segment(distributionId)}/links?${params.toString()}`;
    // Despite being a GET, Qualtrics documents that this request can update
    // contact-frequency state and reset email-status dates.
    this.client.assertWriteAccess(endpoint, undefined, "GET (side-effecting)");
    return this.client.makeRequest(endpoint);
  }

  async createReminder(distributionId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/distributions/${segment(distributionId)}/reminders`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createThankYou(distributionId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/distributions/${segment(distributionId)}/thankyous`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}
