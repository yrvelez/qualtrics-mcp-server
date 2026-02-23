import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { ContactApi } from "../services/contact-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolSuccess, withErrorHandling } from "./_helpers.js";

export function registerContactTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const contactApi = new ContactApi(client);

  // List mailing lists
  server.tool(
    "list_mailing_lists",
    "List all mailing lists in your Qualtrics account",
    {},
    withErrorHandling("list_mailing_lists", async () => {
      const result = await contactApi.listMailingLists();
      const lists = result.result.elements || [];

      return toolSuccess({
        mailingLists: lists.map((ml: any) => ({
          id: ml.id,
          name: ml.name,
          category: ml.category,
          contactCount: ml.contactCount,
          lastModifiedDate: ml.lastModifiedDate,
        })),
        total: lists.length,
      });
    })
  );

  // Create mailing list
  server.tool(
    "create_mailing_list",
    "Create a new mailing list for contact management and survey distribution",
    {
      name: z.string().min(1).describe("Name for the mailing list"),
      category: z.string().optional().describe("Category/folder for the mailing list"),
    },
    withErrorHandling("create_mailing_list", async (args) => {
      const data: Record<string, any> = { name: args.name };
      if (args.category) data.category = args.category;

      const result = await contactApi.createMailingList(data);
      return toolSuccess({
        success: true,
        mailingListId: result.result.id,
        message: `Mailing list "${args.name}" created successfully`,
        details: result.result,
      });
    })
  );

  // Delete mailing list
  server.tool(
    "delete_mailing_list",
    "Delete a mailing list",
    {
      mailingListId: z.string().min(1).describe("The mailing list ID to delete"),
    },
    withErrorHandling("delete_mailing_list", async (args) => {
      const result = await contactApi.deleteMailingList(args.mailingListId);
      return toolSuccess({
        success: true,
        mailingListId: args.mailingListId,
        message: "Mailing list deleted successfully",
        details: result.result,
      });
    })
  );

  // List contacts
  server.tool(
    "list_contacts",
    "List contacts in a mailing list with pagination",
    {
      mailingListId: z.string().min(1).describe("The mailing list ID"),
      limit: z.number().optional().describe("Maximum number of contacts to return"),
      offset: z.number().optional().describe("Starting offset for pagination"),
    },
    withErrorHandling("list_contacts", async (args) => {
      const result = await contactApi.listContacts(args.mailingListId, args.offset, args.limit);
      const contacts = result.result.elements || [];

      return toolSuccess({
        mailingListId: args.mailingListId,
        contacts: contacts.map((c: any) => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          language: c.language,
          unsubscribed: c.unsubscribed,
        })),
        total: contacts.length,
        nextPage: result.result.nextPage || null,
      });
    })
  );

  // Add contact
  server.tool(
    "add_contact",
    "Add a single contact to a mailing list",
    {
      mailingListId: z.string().min(1).describe("The mailing list ID"),
      email: z.string().min(1).describe("Contact email address"),
      firstName: z.string().optional().describe("Contact first name"),
      lastName: z.string().optional().describe("Contact last name"),
      language: z.string().optional().describe("Contact language code (e.g., EN)"),
      embeddedData: z.record(z.any()).optional().describe("Custom embedded data fields for the contact"),
    },
    withErrorHandling("add_contact", async (args) => {
      const data: Record<string, any> = { email: args.email };
      if (args.firstName) data.firstName = args.firstName;
      if (args.lastName) data.lastName = args.lastName;
      if (args.language) data.language = args.language;
      if (args.embeddedData) data.embeddedData = args.embeddedData;

      const result = await contactApi.createContact(args.mailingListId, data);
      return toolSuccess({
        success: true,
        mailingListId: args.mailingListId,
        contactId: result.result.id,
        message: `Contact "${args.email}" added successfully`,
        details: result.result,
      });
    })
  );

  // Update contact
  server.tool(
    "update_contact",
    "Update an existing contact in a mailing list",
    {
      mailingListId: z.string().min(1).describe("The mailing list ID"),
      contactId: z.string().min(1).describe("The contact ID to update"),
      email: z.string().optional().describe("Updated email address"),
      firstName: z.string().optional().describe("Updated first name"),
      lastName: z.string().optional().describe("Updated last name"),
      embeddedData: z.record(z.any()).optional().describe("Updated embedded data fields"),
    },
    withErrorHandling("update_contact", async (args) => {
      const data: Record<string, any> = {};
      if (args.email !== undefined) data.email = args.email;
      if (args.firstName !== undefined) data.firstName = args.firstName;
      if (args.lastName !== undefined) data.lastName = args.lastName;
      if (args.embeddedData !== undefined) data.embeddedData = args.embeddedData;

      const result = await contactApi.updateContact(args.mailingListId, args.contactId, data);
      return toolSuccess({
        success: true,
        mailingListId: args.mailingListId,
        contactId: args.contactId,
        message: "Contact updated successfully",
        details: result.result,
      });
    })
  );

  // Remove contact
  server.tool(
    "remove_contact",
    "Remove a contact from a mailing list",
    {
      mailingListId: z.string().min(1).describe("The mailing list ID"),
      contactId: z.string().min(1).describe("The contact ID to remove"),
    },
    withErrorHandling("remove_contact", async (args) => {
      const result = await contactApi.deleteContact(args.mailingListId, args.contactId);
      return toolSuccess({
        success: true,
        mailingListId: args.mailingListId,
        contactId: args.contactId,
        message: "Contact removed successfully",
        details: result.result,
      });
    })
  );

  // Bulk import contacts
  server.tool(
    "bulk_import_contacts",
    "Import multiple contacts into a mailing list at once",
    {
      mailingListId: z.string().min(1).describe("The mailing list ID"),
      contacts: z.array(z.object({
        email: z.string().describe("Contact email address"),
        firstName: z.string().optional().describe("Contact first name"),
        lastName: z.string().optional().describe("Contact last name"),
        language: z.string().optional().describe("Contact language code"),
        embeddedData: z.record(z.any()).optional().describe("Custom embedded data"),
      })).min(1).describe("Array of contacts to import"),
    },
    withErrorHandling("bulk_import_contacts", async (args) => {
      const result = await contactApi.bulkImportContacts(args.mailingListId, args.contacts);
      return toolSuccess({
        success: true,
        mailingListId: args.mailingListId,
        contactsImported: args.contacts.length,
        message: `${args.contacts.length} contacts imported successfully`,
        details: result.result,
      });
    })
  );
}
