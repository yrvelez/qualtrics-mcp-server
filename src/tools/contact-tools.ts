import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { ContactApi, contactNextSkipToken } from "../services/contact-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolError, toolSuccess, withErrorHandling, requireDeleteConfirmation } from "./_helpers.js";

const directoryIdSchema = z.string().min(1).describe(
  "Required XM Directory ID (POOL_...), also known as the directory or pool ID"
);

export function registerContactTools(
  server: McpServer,
  client: QualtricsClient,
  _config: QualtricsConfig
) {
  const contactApi = new ContactApi(client);

  // List XM directories (pool-ID discovery)
  server.registerTool(
    "list_directories",
    {
      description: "List the XM Directories (contact pools) available to this account. Use this first to discover the directoryId (POOL_...) that every mailing-list and contact tool requires.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        pageSize: z.number().int().positive().max(100).optional().describe("Maximum directories on this page"),
        skipToken: z.string().min(1).optional().describe("XM Directory pagination token from nextSkipToken"),
      },
    },
    withErrorHandling("list_directories", async (args) => {
      const result = await contactApi.listDirectories(args);
      const directories = result.result?.elements || [];
      const nextPage = result.result?.nextPage ?? null;

      return toolSuccess({
        directories: directories.map((d: any) => ({
          directoryId: d.directoryId ?? d.id,
          name: d.name,
          contactCount: d.contactCount,
          isDefault: d.isDefault,
          deduplicationCriteria: d.deduplicationCriteria,
        })),
        returned: directories.length,
        nextPage,
        nextSkipToken: contactNextSkipToken(nextPage),
      });
    })
  );

  // List mailing lists
  server.registerTool(
    "list_mailing_lists",
    {
      description: "List one cursor-paginated page of mailing lists in an XM Directory",
      annotations: { readOnlyHint: true },
      inputSchema: {
        directoryId: directoryIdSchema,
        ownerId: z.string().min(1).optional().describe("XM Directory owner or group ID used to include shared mailing lists"),
        pageSize: z.number().int().positive().max(100).optional().describe("XM Directory page size (maximum 100)"),
        skipToken: z.string().min(1).optional().describe("XM Directory pagination token from nextSkipToken"),
        includeCount: z.boolean().optional().describe("Ask XM Directory to calculate approximate contact counts"),
      },
    },
    withErrorHandling("list_mailing_lists", async (args) => {
      const result = await contactApi.listMailingLists(args);
      const lists = result.result?.elements || [];
      const nextPage = result.result?.nextPage ?? null;

      return toolSuccess({
        directoryId: args.directoryId,
        apiMode: "xm-directory",
        mailingLists: lists.map((ml: any) => ({
          id: ml.mailingListId ?? ml.id,
          name: ml.name,
          category: ml.category,
          contactCount: ml.contactCount,
          lastModifiedDate: ml.lastModifiedDate,
          creationDate: ml.creationDate,
          ownerId: ml.ownerId,
        })),
        returned: lists.length,
        nextPage,
        nextSkipToken: contactNextSkipToken(nextPage),
      });
    })
  );

  // Get mailing list
  server.registerTool(
    "get_mailing_list",
    {
      description: "Get complete metadata for a mailing list",
      annotations: { readOnlyHint: true },
      inputSchema: {
        directoryId: directoryIdSchema,
        mailingListId: z.string().min(1).describe("The mailing list ID"),
        includeCount: z.boolean().optional().describe("Include the approximate contact count; may be slower for large lists"),
      },
    },
    withErrorHandling("get_mailing_list", async (args) => {
      const result = await contactApi.getMailingList(
        args.mailingListId,
        args.directoryId,
        args.includeCount
      );
      return toolSuccess({
        directoryId: args.directoryId,
        mailingListId: args.mailingListId,
        mailingList: result.result,
      });
    })
  );

  // Update mailing list
  server.registerTool(
    "update_mailing_list",
    {
      description: "Update the name or owner of an XM Directory mailing list",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        directoryId: directoryIdSchema,
        mailingListId: z.string().min(1).describe("The mailing list ID to update"),
        name: z.string().min(1).optional().describe("Updated mailing-list name"),
        ownerId: z.string().min(1).optional().describe("Updated XM Directory owner ID"),
      },
    },
    withErrorHandling("update_mailing_list", async (args) => {
      const data: Record<string, string> = {};
      if (args.name !== undefined) data.name = args.name;
      if (args.ownerId !== undefined) data.ownerId = args.ownerId;
      if (Object.keys(data).length === 0) {
        return toolError("No mailing-list changes supplied.");
      }
      const result = await contactApi.updateMailingList(
        args.mailingListId,
        data,
        args.directoryId
      );
      return toolSuccess({
        success: true,
        directoryId: args.directoryId,
        mailingListId: args.mailingListId,
        message: "Mailing list updated successfully",
        details: result.result,
        meta: result.meta,
      });
    })
  );

  // Create mailing list
  server.registerTool(
    "create_mailing_list",
    {
      description: "Create a new mailing list for contact management and survey distribution",
      annotations: { destructiveHint: false },
      inputSchema: {
        directoryId: directoryIdSchema,
        name: z.string().min(1).describe("Name for the mailing list"),
        ownerId: z.string().min(1).optional().describe("XM Directory owner ID; valid only with directoryId"),
      },
    },
    withErrorHandling("create_mailing_list", async (args) => {
      const data: Record<string, any> = { name: args.name };
      if (args.ownerId) data.ownerId = args.ownerId;

      const result = await contactApi.createMailingList(data, args.directoryId);
      return toolSuccess({
        success: true,
        directoryId: args.directoryId,
        mailingListId: result.result?.mailingListId ?? result.result?.id,
        message: `Mailing list "${args.name}" created successfully`,
        details: result.result,
      });
    })
  );

  // Delete mailing list
  server.registerTool(
    "delete_mailing_list",
    {
      description: "Delete a mailing list",
      annotations: { destructiveHint: true },
      inputSchema: {
        directoryId: directoryIdSchema,
        mailingListId: z.string().min(1).describe("The mailing list ID to delete"),
        confirmDelete: z.boolean().describe("Must be true to confirm deletion"),
      },
    },
    withErrorHandling("delete_mailing_list", async (args) => {
      const guard = requireDeleteConfirmation(args);
      if (guard) return guard;
      const result = await contactApi.deleteMailingList(
        args.mailingListId,
        args.directoryId
      );
      return toolSuccess({
        success: true,
        directoryId: args.directoryId,
        mailingListId: args.mailingListId,
        message: "Mailing list deleted successfully",
        details: result.result,
      });
    })
  );

  // List contacts
  server.registerTool(
    "list_contacts",
    {
      description: "List one cursor-paginated page of contacts in an XM Directory mailing list",
      annotations: { readOnlyHint: true },
      inputSchema: {
        directoryId: directoryIdSchema,
        mailingListId: z.string().min(1).describe("The mailing list ID"),
        pageSize: z.number().int().positive().max(50).optional().describe("Maximum contacts on this page (XM Directory maximum: 50)"),
        skipToken: z.string().min(1).optional().describe("XM Directory cursor returned as nextSkipToken"),
        includeEmbedded: z.boolean().optional().describe("Include embeddedData in XM Directory results"),
      },
    },
    withErrorHandling("list_contacts", async (args) => {
      const result = await contactApi.listContacts(args.mailingListId, {
        directoryId: args.directoryId,
        pageSize: args.pageSize,
        skipToken: args.skipToken,
        includeEmbedded: args.includeEmbedded,
      });
      const contacts = result.result?.elements || [];
      const nextPage = result.result?.nextPage ?? null;

      return toolSuccess({
        directoryId: args.directoryId,
        apiMode: "xm-directory",
        mailingListId: args.mailingListId,
        contacts: contacts.map((c: any) => ({
          id: c.contactId ?? c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone: c.phone,
          externalDataReference: c.extRef ?? c.externalDataReference,
          language: c.language,
          unsubscribed: c.unsubscribed,
          embeddedData: c.embeddedData,
        })),
        returned: contacts.length,
        nextPage,
        nextSkipToken: contactNextSkipToken(nextPage),
      });
    })
  );

  // Get contact
  server.registerTool(
    "get_contact",
    {
      description: "Get detailed information for one contact in an XM Directory mailing list",
      annotations: { readOnlyHint: true },
      inputSchema: {
        directoryId: directoryIdSchema,
        mailingListId: z.string().min(1).describe("The mailing list ID"),
        contactId: z.string().min(1).describe("The contact ID"),
      },
    },
    withErrorHandling("get_contact", async (args) => {
      const result = await contactApi.getContact(
        args.mailingListId,
        args.contactId,
        args.directoryId
      );
      return toolSuccess({
        directoryId: args.directoryId,
        mailingListId: args.mailingListId,
        contactId: result.result?.contactId ?? args.contactId,
        contact: result.result,
      });
    })
  );

  // Add contact
  server.registerTool(
    "add_contact",
    {
      description: "Add a single contact to a mailing list",
      annotations: { destructiveHint: false },
      inputSchema: {
        directoryId: directoryIdSchema,
        mailingListId: z.string().min(1).describe("The mailing list ID"),
        email: z.string().min(1).optional().describe("Contact email address; identity requirements vary by directory settings"),
        firstName: z.string().min(1).optional().describe("Contact first name"),
        lastName: z.string().min(1).optional().describe("Contact last name"),
        phone: z.string().optional().describe("Contact phone number"),
        externalDataReference: z.string().optional().describe("External reference (sent as extRef in XM Directory)"),
        language: z.string().optional().describe("Contact language code (e.g., EN)"),
        unsubscribed: z.boolean().optional().describe("Contact unsubscribe state"),
        embeddedData: z.record(z.any()).optional().describe("Custom embedded data fields for the contact"),
      },
    },
    withErrorHandling("add_contact", async (args) => {
      if (![args.email, args.firstName, args.lastName, args.externalDataReference]
        .some((value) => typeof value === "string" && value.length > 0)) {
        return toolError(
          "Provide at least one contact identity field: email, firstName, lastName, or externalDataReference. Exact identity requirements depend on XM Directory settings."
        );
      }
      const data: Record<string, any> = {};
      if (args.email) data.email = args.email;
      if (args.firstName) data.firstName = args.firstName;
      if (args.lastName) data.lastName = args.lastName;
      if (args.phone) data.phone = args.phone;
      if (args.externalDataReference) data.extRef = args.externalDataReference;
      if (args.language) data.language = args.language;
      if (args.unsubscribed !== undefined) data.unsubscribed = args.unsubscribed;
      if (args.embeddedData) data.embeddedData = args.embeddedData;

      const result = await contactApi.createContact(
        args.mailingListId,
        data,
        args.directoryId
      );
      return toolSuccess({
        success: true,
        directoryId: args.directoryId,
        mailingListId: args.mailingListId,
        contactId: result.result?.contactId ?? result.result?.id,
        message: "Contact added successfully",
        details: result.result,
      });
    })
  );

  // Update contact
  server.registerTool(
    "update_contact",
    {
      description: "Update an existing contact in a mailing list",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        directoryId: directoryIdSchema,
        mailingListId: z.string().min(1).describe("The mailing list ID"),
        contactId: z.string().min(1).describe("The contact ID to update"),
        email: z.string().optional().describe("Updated email address"),
        firstName: z.string().optional().describe("Updated first name"),
        lastName: z.string().optional().describe("Updated last name"),
        phone: z.string().optional().describe("Updated phone number"),
        externalDataReference: z.string().optional().describe("Updated external reference (extRef)"),
        language: z.string().optional().describe("Updated language code"),
        unsubscribed: z.boolean().optional().describe("Updated unsubscribe state"),
        embeddedData: z.record(z.any()).optional().describe("Updated embedded data fields"),
      },
    },
    withErrorHandling("update_contact", async (args) => {
      const data: Record<string, any> = {};
      if (args.email !== undefined) data.email = args.email;
      if (args.firstName !== undefined) data.firstName = args.firstName;
      if (args.lastName !== undefined) data.lastName = args.lastName;
      if (args.phone !== undefined) data.phone = args.phone;
      if (args.externalDataReference !== undefined) data.extRef = args.externalDataReference;
      if (args.language !== undefined) data.language = args.language;
      if (args.unsubscribed !== undefined) data.unsubscribed = args.unsubscribed;
      if (args.embeddedData !== undefined) data.embeddedData = args.embeddedData;

      if (Object.keys(data).length === 0) {
        return toolError("No contact changes supplied.");
      }

      const result = await contactApi.updateContact(
        args.mailingListId,
        args.contactId,
        data,
        args.directoryId
      );
      return toolSuccess({
        success: true,
        directoryId: args.directoryId,
        mailingListId: args.mailingListId,
        contactId: args.contactId,
        message: "Contact updated successfully",
        details: result.result,
      });
    })
  );

  // Remove contact
  server.registerTool(
    "remove_contact",
    {
      description: "Remove a contact from this mailing list only; the contact remains in the XM Directory",
      annotations: { destructiveHint: true },
      inputSchema: {
        directoryId: directoryIdSchema,
        mailingListId: z.string().min(1).describe("The mailing list ID"),
        contactId: z.string().min(1).describe("The contact ID to remove"),
        confirmDelete: z.boolean().describe("Must be true to confirm deletion"),
      },
    },
    withErrorHandling("remove_contact", async (args) => {
      const guard = requireDeleteConfirmation(args);
      if (guard) return guard;
      const result = await contactApi.deleteContact(
        args.mailingListId,
        args.contactId,
        args.directoryId
      );
      return toolSuccess({
        success: true,
        directoryId: args.directoryId,
        mailingListId: args.mailingListId,
        contactId: args.contactId,
        message: "Contact removed successfully",
        details: result.result,
      });
    })
  );

  // Bulk import contacts
  server.registerTool(
    "bulk_import_contacts",
    {
      description: "Create multiple contacts through the documented single-contact endpoint, returning per-contact successes and failures (non-atomic)",
      annotations: { destructiveHint: false },
      inputSchema: {
        directoryId: directoryIdSchema,
        mailingListId: z.string().min(1).describe("The mailing list ID"),
        contacts: z.array(z.object({
          email: z.string().min(1).optional().describe("Contact email address; identity requirements vary by directory settings"),
          firstName: z.string().min(1).optional().describe("Contact first name"),
          lastName: z.string().min(1).optional().describe("Contact last name"),
          phone: z.string().optional().describe("Contact phone number"),
          externalDataReference: z.string().optional().describe("External reference"),
          language: z.string().optional().describe("Contact language code"),
          unsubscribed: z.boolean().optional().describe("Contact unsubscribe state"),
          embeddedData: z.record(z.any()).optional().describe("Custom embedded data"),
        })).min(1).max(100).describe("Array of up to 100 contacts to create sequentially"),
      },
    },
    withErrorHandling("bulk_import_contacts", async (args) => {
      const invalidIndex = args.contacts.findIndex(
        (contact: Record<string, any>) => ![
          contact.email,
          contact.firstName,
          contact.lastName,
          contact.externalDataReference,
        ].some((value) => typeof value === "string" && value.length > 0)
      );
      if (invalidIndex !== -1) {
        return toolError(
          `Contact at index ${invalidIndex} has no identity field. Provide email, firstName, lastName, or externalDataReference; exact requirements depend on XM Directory settings.`
        );
      }
      const contacts = args.contacts.map((contact: Record<string, any>) => {
        const { externalDataReference, ...rest } = contact;
        return externalDataReference === undefined
          ? rest
          : { ...rest, extRef: externalDataReference };
      });
      const result = await contactApi.bulkImportContacts(
        args.mailingListId,
        contacts,
        args.directoryId
      );
      const created = result.result.created ?? [];
      const errors = result.result.errors ?? [];
      return toolSuccess({
        success: errors.length === 0,
        directoryId: args.directoryId,
        mailingListId: args.mailingListId,
        contactsRequested: args.contacts.length,
        contactsImported: created.length,
        contactsFailed: errors.length,
        message: `${created.length} of ${args.contacts.length} contacts created`,
        createdContacts: created.map((entry: any) => ({
          index: entry.index,
          contactId: entry.result?.contactId ?? entry.result?.id,
        })),
        details: result.result,
      });
    })
  );
}
