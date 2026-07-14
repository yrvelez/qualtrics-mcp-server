import { Buffer } from "node:buffer";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { LibraryApi } from "../services/library-api.js";
import {
  requireDeleteConfirmation,
  toolSuccess,
  withErrorHandling,
} from "./_helpers.js";

const MESSAGE_CATEGORIES = [
  "invite",
  "thankYou",
  "reminder",
  "endOfSurvey",
  "inactiveSurvey",
  "general",
  "lookAndFeel",
  "emailSubject",
  "smsInvite",
  "smsReminder",
  "smsThankYou",
  "validation",
  "evaluatorInvite",
  "evaluatorReminder",
  "subjectLine",
] as const;

const GRAPHIC_CONTENT_TYPES = ["image/jpeg", "image/gif", "image/png"] as const;

function isGraphicSignature(bytes: Buffer, contentType: typeof GRAPHIC_CONTENT_TYPES[number]): boolean {
  if (contentType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
}

export function registerLibraryTools(server: McpServer, client: QualtricsClient) {
  const libraryApi = new LibraryApi(client);

  server.registerTool(
    "list_libraries",
    {
      description: "List Qualtrics libraries available to the current API user",
      annotations: { readOnlyHint: true },
      inputSchema: {
        offset: z.number().int().nonnegative().optional().describe("Pagination offset"),
      },
    },
    withErrorHandling("list_libraries", async (args) => {
      const result = await libraryApi.listLibraries(args.offset);
      return toolSuccess({
        libraries: result.result?.elements ?? [],
        nextPage: result.result?.nextPage ?? null,
      });
    })
  );

  for (const resource of ["blocks", "questions", "surveys"] as const) {
    const singular = resource.slice(0, -1);
    server.registerTool(
      `list_library_${resource}`,
      {
        description:
          `List reusable survey ${resource} in a Qualtrics library. Use these templates to discover complex ${singular} definitions before copying or recreating them through MCP.`,
        annotations: { readOnlyHint: true },
        inputSchema: {
          libraryId: z.string().min(1).describe("The library ID"),
          offset: z.number().int().nonnegative().optional().describe("Pagination offset"),
        },
      },
      withErrorHandling(`list_library_${resource}`, async (args) => {
        const result = await libraryApi.listSurveyResources(
          args.libraryId,
          resource,
          args.offset
        );
        return toolSuccess({
          libraryId: args.libraryId,
          resource,
          [resource]: result.result?.elements ?? [],
          nextPage: result.result?.nextPage ?? null,
        });
      })
    );
  }

  server.registerTool(
    "list_library_messages",
    {
      description:
        "List reusable email, survey, validation, SMS, and subject messages in a library. Use this to find messageId values for distributions.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        libraryId: z.string().min(1).describe("The library ID"),
        category: z.enum(MESSAGE_CATEGORIES).optional().describe("Optional message category filter"),
        offset: z.number().int().nonnegative().optional().describe("Pagination offset"),
      },
    },
    withErrorHandling("list_library_messages", async (args) => {
      const result = await libraryApi.listMessages(
        args.libraryId,
        args.category,
        args.offset
      );
      return toolSuccess({
        libraryId: args.libraryId,
        messages: result.result?.elements ?? [],
        nextPage: result.result?.nextPage ?? null,
      });
    })
  );

  server.registerTool(
    "get_library_message",
    {
      description: "Get the complete multilingual content of a library message",
      annotations: { readOnlyHint: true },
      inputSchema: {
        libraryId: z.string().min(1).describe("The library ID"),
        messageId: z.string().min(1).describe("The message ID"),
      },
    },
    withErrorHandling("get_library_message", async (args) => {
      const result = await libraryApi.getMessage(args.libraryId, args.messageId);
      return toolSuccess({
        libraryId: args.libraryId,
        messageId: args.messageId,
        message: result.result,
      });
    })
  );

  server.registerTool(
    "create_library_message",
    {
      description:
        "Create a reusable multilingual library message for invitations, reminders, thank-yous, end-of-survey text, validation, or other supported categories.",
      annotations: { destructiveHint: false },
      inputSchema: {
        libraryId: z.string().min(1).describe("The library ID"),
        description: z.string().min(1).describe("Internal message description"),
        category: z.enum(MESSAGE_CATEGORIES).describe("Message category"),
        messages: z.record(z.string()).describe("Message content keyed by language code, for example {EN: '<p>Hello</p>'}"),
      },
    },
    withErrorHandling("create_library_message", async (args) => {
      const result = await libraryApi.createMessage(args.libraryId, {
        description: args.description,
        category: args.category,
        messages: args.messages,
      });
      return toolSuccess({
        success: true,
        libraryId: args.libraryId,
        messageId: result.result?.id ?? null,
        message: "Library message created successfully",
        details: result.result,
      });
    })
  );

  server.registerTool(
    "update_library_message",
    {
      description:
        "Safely update a library message. Existing description and language content are fetched and preserved unless explicitly replaced.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        libraryId: z.string().min(1).describe("The library ID"),
        messageId: z.string().min(1).describe("The message ID"),
        description: z.string().min(1).optional().describe("Updated internal description"),
        messages: z.record(z.string()).optional().describe("Language content to merge with existing content"),
      },
    },
    withErrorHandling("update_library_message", async (args) => {
      const current = await libraryApi.getMessage(args.libraryId, args.messageId);
      const data = {
        description: args.description ?? current.result.description,
        messages: {
          ...(current.result.messages ?? {}),
          ...(args.messages ?? {}),
        },
      };
      const result = await libraryApi.updateMessage(
        args.libraryId,
        args.messageId,
        data
      );
      return toolSuccess({
        success: true,
        libraryId: args.libraryId,
        messageId: args.messageId,
        message: "Library message updated successfully",
        details: result.result,
      });
    })
  );

  server.registerTool(
    "delete_library_message",
    {
      description: "Permanently delete a reusable library message",
      annotations: { destructiveHint: true },
      inputSchema: {
        libraryId: z.string().min(1).describe("The library ID"),
        messageId: z.string().min(1).describe("The message ID"),
        confirmDelete: z.boolean().describe("Must be true to confirm deletion"),
      },
    },
    withErrorHandling("delete_library_message", async (args) => {
      const guard = requireDeleteConfirmation(args);
      if (guard) return guard;
      const result = await libraryApi.deleteMessage(args.libraryId, args.messageId);
      return toolSuccess({
        success: true,
        libraryId: args.libraryId,
        messageId: args.messageId,
        message: "Library message deleted successfully",
        details: result?.result,
      });
    })
  );

  server.registerTool(
    "upload_library_graphic",
    {
      description:
        "Upload a non-confidential JPEG, GIF, or PNG graphic to a Qualtrics library from either a public HTTPS URL or base64 bytes. Uploaded graphics can be publicly accessible through their resulting URL.",
      annotations: { destructiveHint: false },
      inputSchema: {
        libraryId: z.string().min(1).describe("The library ID"),
        name: z.string().min(1).describe("Name for the graphic in Qualtrics"),
        contentType: z.enum(GRAPHIC_CONTENT_TYPES).describe("Graphic MIME type"),
        fileUrl: z.string().url().optional().describe("Public HTTPS image URL; mutually exclusive with contentBase64"),
        contentBase64: z.string().min(1).optional().describe("Base64 image bytes; mutually exclusive with fileUrl and limited to 10 MB decoded"),
        filename: z.string().min(1).optional().describe("Filename used for a base64 upload"),
        folder: z.string().optional().describe("Optional Qualtrics library folder"),
      },
    },
    withErrorHandling("upload_library_graphic", async (args) => {
      if ((args.fileUrl === undefined) === (args.contentBase64 === undefined)) {
        return {
          content: [{
            type: "text" as const,
            text: "Provide exactly one of fileUrl or contentBase64.",
          }],
          isError: true,
        };
      }

      const form = new FormData();
      form.set("name", args.name);
      if (args.folder !== undefined) form.set("folder", args.folder);

      if (args.fileUrl !== undefined) {
        const url = new URL(args.fileUrl);
        if (url.protocol !== "https:") {
          return {
            content: [{ type: "text" as const, text: "fileUrl must use HTTPS." }],
            isError: true,
          };
        }
        form.set("fileUrl", args.fileUrl);
        form.set("contentType", args.contentType);
      } else {
        const bytes = Buffer.from(args.contentBase64!, "base64");
        if (bytes.length === 0) {
          return {
            content: [{ type: "text" as const, text: "contentBase64 decoded to an empty file." }],
            isError: true,
          };
        }
        if (bytes.length > 10 * 1024 * 1024) {
          return {
            content: [{ type: "text" as const, text: "Graphic exceeds the MCP tool's 10 MB decoded-size limit; use fileUrl instead." }],
            isError: true,
          };
        }
        if (!isGraphicSignature(bytes, args.contentType)) {
          return {
            content: [{ type: "text" as const, text: `Decoded bytes do not match ${args.contentType}.` }],
            isError: true,
          };
        }
        const extension = args.contentType === "image/jpeg"
          ? "jpg"
          : args.contentType.split("/")[1];
        const blob = new Blob([bytes], { type: args.contentType });
        form.set("file", blob, args.filename ?? `${args.name}.${extension}`);
      }

      const result = await libraryApi.uploadGraphic(args.libraryId, form);
      return toolSuccess({
        success: true,
        libraryId: args.libraryId,
        graphicId: result.result?.id ?? null,
        name: args.name,
        message: "Library graphic uploaded successfully",
        details: result.result,
      });
    })
  );

  server.registerTool(
    "delete_library_graphic",
    {
      description: "Permanently delete a graphic from a Qualtrics library",
      annotations: { destructiveHint: true },
      inputSchema: {
        libraryId: z.string().min(1).describe("The library ID"),
        graphicId: z.string().min(1).describe("The graphic ID"),
        confirmDelete: z.boolean().describe("Must be true to confirm deletion"),
      },
    },
    withErrorHandling("delete_library_graphic", async (args) => {
      const guard = requireDeleteConfirmation(args);
      if (guard) return guard;
      const result = await libraryApi.deleteGraphic(args.libraryId, args.graphicId);
      return toolSuccess({
        success: true,
        libraryId: args.libraryId,
        graphicId: args.graphicId,
        message: "Library graphic deleted successfully",
        details: result?.result,
      });
    })
  );
}
