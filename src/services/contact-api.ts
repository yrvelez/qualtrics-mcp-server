import { QualtricsClient } from "./qualtrics-client.js";

export interface MailingListPageOptions {
  directoryId: string;
  ownerId?: string;
  pageSize?: number;
  skipToken?: string;
  includeCount?: boolean;
}

export interface ContactPageOptions {
  directoryId: string;
  pageSize?: number;
  skipToken?: string;
  includeEmbedded?: boolean;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function queryString(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function contactNextSkipToken(nextPage: unknown): string | null {
  if (typeof nextPage !== "string" || nextPage.length === 0) return null;
  try {
    const parsed = new URL(nextPage, "https://qualtrics.invalid");
    return parsed.searchParams.get("skipToken") ?? nextPage;
  } catch {
    return nextPage;
  }
}

export class ContactApi {
  constructor(private client: QualtricsClient) {}

  async listMailingLists(options: MailingListPageOptions): Promise<any> {
    const query = queryString({
      ownerId: options.ownerId,
      pageSize: options.pageSize,
      skipToken: options.skipToken,
      includeCount: options.includeCount,
      useNewPaginationScheme: true,
    });
    return this.client.makeRequest(
      `/directories/${segment(options.directoryId)}/mailinglists${query}`
    );
  }

  async createMailingList(
    data: Record<string, any>,
    directoryId: string
  ): Promise<any> {
    const endpoint = `/directories/${segment(directoryId)}/mailinglists`;
    return this.client.makeRequest(endpoint, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getMailingList(
    mailingListId: string,
    directoryId: string,
    includeCount?: boolean
  ): Promise<any> {
    const endpoint =
      `/directories/${segment(directoryId)}/mailinglists/${segment(mailingListId)}` +
      queryString({ includeCount });
    return this.client.makeRequest(endpoint);
  }

  async updateMailingList(
    mailingListId: string,
    data: Record<string, any>,
    directoryId: string
  ): Promise<any> {
    const endpoint =
      `/directories/${segment(directoryId)}/mailinglists/${segment(mailingListId)}`;
    return this.client.makeRequest(endpoint, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteMailingList(mailingListId: string, directoryId: string): Promise<any> {
    const endpoint =
      `/directories/${segment(directoryId)}/mailinglists/${segment(mailingListId)}`;
    return this.client.makeRequest(endpoint, {
      method: "DELETE",
    });
  }

  async listContacts(
    mailingListId: string,
    options: ContactPageOptions
  ): Promise<any> {
    const query = queryString({
      pageSize: options.pageSize,
      skipToken: options.skipToken,
      includeEmbedded: options.includeEmbedded,
      useNewPaginationScheme: true,
    });
    return this.client.makeRequest(
      `/directories/${segment(options.directoryId)}/mailinglists/${segment(mailingListId)}/contacts${query}`
    );
  }

  async createContact(
    mailingListId: string,
    data: Record<string, any>,
    directoryId: string
  ): Promise<any> {
    const endpoint =
      `/directories/${segment(directoryId)}/mailinglists/${segment(mailingListId)}/contacts`;
    return this.client.makeRequest(endpoint, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getContact(
    mailingListId: string,
    contactId: string,
    directoryId: string
  ): Promise<any> {
    const endpoint =
      `/directories/${segment(directoryId)}/mailinglists/${segment(mailingListId)}/contacts/${segment(contactId)}`;
    return this.client.makeRequest(endpoint);
  }

  async updateContact(
    mailingListId: string,
    contactId: string,
    data: Record<string, any>,
    directoryId: string
  ): Promise<any> {
    const endpoint =
      `/directories/${segment(directoryId)}/mailinglists/${segment(mailingListId)}/contacts/${segment(contactId)}`;
    return this.client.makeRequest(endpoint, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteContact(
    mailingListId: string,
    contactId: string,
    directoryId: string
  ): Promise<any> {
    const endpoint =
      `/directories/${segment(directoryId)}/mailinglists/${segment(mailingListId)}/contacts/${segment(contactId)}`;
    return this.client.makeRequest(endpoint, {
      method: "DELETE",
    });
  }

  async bulkImportContacts(
    mailingListId: string,
    contacts: Array<Record<string, any>>,
    directoryId: string
  ): Promise<any> {
    // The documented mailing-list endpoint creates one contact per request.
    // Loop deliberately instead of sending an undocumented {contacts: [...]} body.
    const created: Array<{ index: number; result: any }> = [];
    const errors: Array<{ index: number; error: string }> = [];
    for (const [index, contact] of contacts.entries()) {
      try {
        const response = await this.createContact(
          mailingListId,
          contact,
          directoryId
        );
        created.push({ index, result: response.result });
      } catch (error) {
        errors.push({
          index,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { result: { created, errors } };
  }
}
