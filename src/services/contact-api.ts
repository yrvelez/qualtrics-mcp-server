import { QualtricsClient } from "./qualtrics-client.js";

export class ContactApi {
  constructor(private client: QualtricsClient) {}

  async listMailingLists(): Promise<any> {
    return this.client.makeRequest("/mailinglists");
  }

  async createMailingList(data: Record<string, any>): Promise<any> {
    return this.client.makeRequest("/mailinglists", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getMailingList(mailingListId: string): Promise<any> {
    return this.client.makeRequest(`/mailinglists/${mailingListId}`);
  }

  async deleteMailingList(mailingListId: string): Promise<any> {
    return this.client.makeRequest(`/mailinglists/${mailingListId}`, {
      method: "DELETE",
    });
  }

  async listContacts(mailingListId: string, offset?: number, limit?: number): Promise<any> {
    const params = new URLSearchParams();
    if (offset !== undefined) params.set("offset", String(offset));
    if (limit !== undefined) params.set("pageSize", String(limit));
    const qs = params.toString();
    return this.client.makeRequest(`/mailinglists/${mailingListId}/contacts${qs ? `?${qs}` : ""}`);
  }

  async createContact(mailingListId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/mailinglists/${mailingListId}/contacts`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateContact(mailingListId: string, contactId: string, data: Record<string, any>): Promise<any> {
    return this.client.makeRequest(`/mailinglists/${mailingListId}/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteContact(mailingListId: string, contactId: string): Promise<any> {
    return this.client.makeRequest(`/mailinglists/${mailingListId}/contacts/${contactId}`, {
      method: "DELETE",
    });
  }

  async bulkImportContacts(mailingListId: string, contacts: Array<Record<string, any>>): Promise<any> {
    return this.client.makeRequest(`/mailinglists/${mailingListId}/contacts`, {
      method: "POST",
      body: JSON.stringify({ contacts }),
    });
  }
}
