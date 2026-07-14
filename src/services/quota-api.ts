import { QualtricsClient } from "./qualtrics-client.js";

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function buildPaginationQuery(pageSize?: number, skipToken?: string): string {
  const params = new URLSearchParams();
  if (pageSize !== undefined) params.set("pageSize", String(pageSize));
  if (skipToken !== undefined) params.set("skipToken", getNextSkipToken(skipToken) ?? skipToken);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getNextSkipToken(nextPage: unknown): string | undefined {
  if (typeof nextPage !== "string" || nextPage.length === 0) return undefined;

  try {
    const parsed = new URL(nextPage, "https://qualtrics.invalid");
    return parsed.searchParams.get("skipToken") ?? nextPage;
  } catch {
    // Some Qualtrics responses return the opaque token itself rather than a URL.
    return nextPage;
  }
}

function isMissingSingleGroupEndpoint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b404\b|\b405\b|not found|method not allowed)/i.test(message);
}

export class QuotaApi {
  constructor(private client: QualtricsClient) {}

  async listQuotas(
    surveyId: string,
    pageSize?: number,
    skipToken?: string
  ): Promise<any> {
    const query = buildPaginationQuery(pageSize, skipToken);
    return this.client.makeRequest(
      `/survey-definitions/${encodePathSegment(surveyId)}/quotas${query}`
    );
  }

  async getQuota(surveyId: string, quotaId: string): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${encodePathSegment(surveyId)}/quotas/${encodePathSegment(quotaId)}`
    );
  }

  async createQuota(
    surveyId: string,
    quota: Record<string, any>,
    quotaGroupId?: string
  ): Promise<any> {
    const params = new URLSearchParams();
    if (quotaGroupId !== undefined) params.set("quotaGroupId", quotaGroupId);
    const query = params.toString();

    return this.client.makeRequest(
      `/survey-definitions/${encodePathSegment(surveyId)}/quotas${query ? `?${query}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(quota),
      }
    );
  }

  async updateQuota(
    surveyId: string,
    quotaId: string,
    quota: Record<string, any>
  ): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${encodePathSegment(surveyId)}/quotas/${encodePathSegment(quotaId)}`,
      {
        method: "PUT",
        body: JSON.stringify(quota),
      }
    );
  }

  async deleteQuota(surveyId: string, quotaId: string): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${encodePathSegment(surveyId)}/quotas/${encodePathSegment(quotaId)}`,
      { method: "DELETE" }
    );
  }

  async listQuotaGroups(
    surveyId: string,
    pageSize?: number,
    skipToken?: string
  ): Promise<any> {
    const query = buildPaginationQuery(pageSize, skipToken);
    return this.client.makeRequest(
      `/survey-definitions/${encodePathSegment(surveyId)}/quotagroups${query}`
    );
  }

  async getQuotaGroup(surveyId: string, quotaGroupId: string): Promise<any> {
    const endpoint =
      `/survey-definitions/${encodePathSegment(surveyId)}/quotagroups/` +
      encodePathSegment(quotaGroupId);

    try {
      return await this.client.makeRequest(endpoint);
    } catch (error) {
      // Some Qualtrics brands expose quota-group update/delete but not GET by ID.
      // Fall back to the documented paginated collection so this MCP action is
      // still portable across brands.
      if (!isMissingSingleGroupEndpoint(error)) throw error;
    }

    let skipToken: string | undefined;
    const seenTokens = new Set<string>();

    while (true) {
      const page = await this.listQuotaGroups(surveyId, 100, skipToken);
      const elements = Array.isArray(page?.result)
        ? page.result
        : page?.result?.elements ?? [];
      const match = elements.find((group: any) =>
        [group?.ID, group?.Id, group?.id, group?.QuotaGroupID].includes(quotaGroupId)
      );

      if (match) {
        return { result: match, meta: page?.meta };
      }

      const nextToken = getNextSkipToken(page?.result?.nextPage);
      if (!nextToken || seenTokens.has(nextToken)) break;
      seenTokens.add(nextToken);
      skipToken = nextToken;
    }

    throw new Error(
      `Quota group ${quotaGroupId} was not found in survey ${surveyId}.`
    );
  }

  async createQuotaGroup(
    surveyId: string,
    quotaGroup: Record<string, any>
  ): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${encodePathSegment(surveyId)}/quotagroups`,
      {
        method: "POST",
        body: JSON.stringify(quotaGroup),
      }
    );
  }

  async updateQuotaGroup(
    surveyId: string,
    quotaGroupId: string,
    quotaGroup: Record<string, any>
  ): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${encodePathSegment(surveyId)}/quotagroups/${encodePathSegment(quotaGroupId)}`,
      {
        method: "PUT",
        body: JSON.stringify(quotaGroup),
      }
    );
  }

  async deleteQuotaGroup(surveyId: string, quotaGroupId: string): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${encodePathSegment(surveyId)}/quotagroups/${encodePathSegment(quotaGroupId)}`,
      { method: "DELETE" }
    );
  }
}
