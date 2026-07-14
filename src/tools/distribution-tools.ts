import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import {
  DistributionApi,
  distributionNextSkipToken,
} from "../services/distribution-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolSuccess, withErrorHandling, requireDeleteConfirmation } from "./_helpers.js";

export function anonymousSurveyUrl(
  brandBaseUrl: string,
  surveyId: string
): string {
  const parsed = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(brandBaseUrl)
      ? brandBaseUrl
      : `https://${brandBaseUrl}`
  );
  if (parsed.protocol !== "https:") {
    throw new Error("Qualtrics returned a non-HTTPS BrandBaseURL.");
  }
  const origin = parsed.origin;
  return new URL(`/jfe/form/${encodeURIComponent(surveyId)}`, origin).toString();
}

export function registerDistributionTools(
  server: McpServer,
  client: QualtricsClient,
  _config: QualtricsConfig
) {
  const distributionApi = new DistributionApi(client);

  // List distributions
  server.registerTool(
    "list_distributions",
    {
      description: "List one cursor-paginated page of distributions for a survey, with optional documented Qualtrics filters",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        mailingListId: z.string().min(1).optional().describe("Filter by recipient mailing list"),
        distributionRequestType: z.enum(["Invite", "ThankYou", "Reminder", "Email", "Portal", "PortalInvite", "GeneratedInvite"]).optional().describe("Filter by distribution request type"),
        sendStartDate: z.string().min(1).optional().describe("Filter sends at or after this ISO date-time"),
        sendEndDate: z.string().min(1).optional().describe("Filter sends at or before this ISO date-time"),
        pageSize: z.number().int().positive().max(100).optional().describe("Maximum distributions on this page"),
        skipToken: z.string().min(1).optional().describe("Cursor returned as nextSkipToken"),
      },
    },
    withErrorHandling("list_distributions", async (args) => {
      const result = await distributionApi.listDistributions(args.surveyId, {
        mailingListId: args.mailingListId,
        distributionRequestType: args.distributionRequestType,
        sendStartDate: args.sendStartDate,
        sendEndDate: args.sendEndDate,
        pageSize: args.pageSize,
        skipToken: args.skipToken,
      });
      const distributions = result.result?.elements || [];
      const nextPage = result.result?.nextPage ?? null;

      return toolSuccess({
        surveyId: args.surveyId,
        distributions: distributions.map((d: any) => ({
          id: d.id,
          requestType: d.requestType,
          requestStatus: d.requestStatus,
          sendDate: d.sendDate,
          createdDate: d.createdDate,
          stats: d.stats,
        })),
        returned: distributions.length,
        nextPage,
        nextSkipToken: distributionNextSkipToken(nextPage),
      });
    })
  );

  // Get distribution
  server.registerTool(
    "get_distribution",
    {
      description: "Get detailed information about a specific distribution including delivery stats",
      annotations: { readOnlyHint: true },
      inputSchema: {
        distributionId: z.string().min(1).describe("The distribution ID"),
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("get_distribution", async (args) => {
      const result = await distributionApi.getDistribution(args.distributionId, args.surveyId);
      return toolSuccess({
        distribution: result.result,
      });
    })
  );

  // Per-recipient delivery history
  server.registerTool(
    "get_distribution_history",
    {
      description: "Get per-recipient delivery history for an email distribution (sent, opened, bounced, blocked, responded), including the contactLookupId that ties each row back to a contact. This is the documented way to recover respondent identity for individual-link distributions after the fact.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        distributionId: z.string().min(1).describe("The distribution ID"),
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        skipToken: z.string().min(1).optional().describe("Opaque token from the prior page's nextPage value"),
      },
    },
    withErrorHandling("get_distribution_history", async (args) => {
      const result = await distributionApi.getDistributionHistory(
        args.distributionId,
        args.surveyId,
        args.skipToken
      );
      return toolSuccess({
        distributionId: args.distributionId,
        surveyId: args.surveyId,
        history: result.result?.elements ?? result.result,
        nextPage: result.result?.nextPage ?? null,
        nextSkipToken: distributionNextSkipToken(result.result?.nextPage),
      });
    })
  );

  // List generated individual links
  server.registerTool(
    "list_distribution_links",
    {
      description: "List one page of generated individual survey links. WARNING: Qualtrics documents that this GET can update contact-frequency state and reset email-status dates when used on other distribution types, so the distributions write scope is required.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        distributionId: z.string().min(1).describe("The distribution ID"),
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        skipToken: z.string().min(1).optional().describe("Opaque token from the prior page's nextPage value"),
      },
    },
    withErrorHandling("list_distribution_links", async (args) => {
      const result = await distributionApi.generateDistributionLinks(
        args.distributionId,
        args.surveyId,
        args.skipToken
      );
      return toolSuccess({
        distributionId: args.distributionId,
        surveyId: args.surveyId,
        links: result.result?.elements ?? result.result,
        nextPage: result.result?.nextPage ?? null,
        nextSkipToken: distributionNextSkipToken(result.result?.nextPage),
      });
    })
  );

  // Create anonymous link
  server.registerTool(
    "create_anonymous_link",
    {
      description: "Look up the survey's BrandBaseURL and return its canonical anonymous survey-taking URL. Qualtrics anonymous links do not require creating a distribution; this tool performs no API write.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("create_anonymous_link", async (args) => {
      const definition = await client.getSurveyDefinition(args.surveyId);
      const brandBaseUrl = definition.result?.BrandBaseURL;
      if (typeof brandBaseUrl !== "string" || brandBaseUrl.length === 0) {
        throw new Error(
          "The survey definition did not include BrandBaseURL, so a respondent URL cannot be constructed safely."
        );
      }
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        distributionId: null,
        anonymousUrl: anonymousSurveyUrl(brandBaseUrl, args.surveyId),
        brandBaseUrl,
        message: "Canonical anonymous survey URL returned; no distribution was created.",
      });
    })
  );

  // Create email distribution
  server.registerTool(
    "create_email_distribution",
    {
      description: "Send a survey via email to a mailing list",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        mailingListId: z.string().min(1).describe("The mailing list ID to send to"),
        fromEmail: z.string().min(1).describe("Verified sender email address"),
        fromName: z.string().min(1).describe("From name displayed in the email"),
        replyToEmail: z.string().min(1).describe("Reply-to email address"),
        subject: z.string().min(1).describe("Email subject line"),
        messageId: z.string().min(1).describe("ID of the message template from the library"),
        libraryId: z.string().min(1).describe("ID of the library containing the message template"),
        sendDate: z.string().optional().describe("Scheduled send date (ISO format). If omitted, sends immediately."),
        expirationDate: z.string().optional().describe("Individual-link expiration date (ISO format)"),
        embeddedData: z.record(z.any()).optional().describe("Optional tags for distribution reporting; these are not survey-flow embedded data"),
      },
    },
    withErrorHandling("create_email_distribution", async (args) => {
      const data: Record<string, any> = {
        recipients: {
          mailingListId: args.mailingListId,
        },
        header: {
          fromEmail: args.fromEmail,
          fromName: args.fromName,
          replyToEmail: args.replyToEmail,
          subject: args.subject,
        },
        message: {
          libraryId: args.libraryId,
          messageId: args.messageId,
        },
        surveyLink: {
          surveyId: args.surveyId,
          type: "Individual",
          ...(args.expirationDate
            ? { expirationDate: args.expirationDate }
            : {}),
        },
      };
      if (args.sendDate) {
        data.sendDate = args.sendDate;
      }
      if (args.embeddedData) data.embeddedData = args.embeddedData;

      const result = await distributionApi.createDistribution(data);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        distributionId: result.result.id,
        message: args.sendDate
          ? `Email distribution scheduled for ${args.sendDate}`
          : "Email distribution created and sending",
        details: result.result,
      });
    })
  );

  // Delete distribution
  server.registerTool(
    "delete_distribution",
    {
      description: "Delete a distribution",
      annotations: { destructiveHint: true },
      inputSchema: {
        distributionId: z.string().min(1).describe("The distribution ID to delete"),
        confirmDelete: z.boolean().describe("Must be true to confirm deletion"),
      },
    },
    withErrorHandling("delete_distribution", async (args) => {
      const guard = requireDeleteConfirmation(args);
      if (guard) return guard;
      const result = await distributionApi.deleteDistribution(args.distributionId);
      return toolSuccess({
        success: true,
        distributionId: args.distributionId,
        message: "Distribution deleted successfully",
        details: result.result,
      });
    })
  );

  // Create reminder
  server.registerTool(
    "create_reminder",
    {
      description: "Send a reminder for an existing email distribution",
      annotations: { destructiveHint: false },
      inputSchema: {
        distributionId: z.string().min(1).describe("The parent distribution ID to send a reminder for"),
        fromEmail: z.string().min(1).describe("Verified sender email address"),
        fromName: z.string().min(1).describe("From name displayed in the reminder email"),
        replyToEmail: z.string().min(1).describe("Reply-to email address"),
        subject: z.string().min(1).describe("Reminder email subject line"),
        messageId: z.string().min(1).describe("ID of the reminder message template"),
        libraryId: z.string().min(1).describe("ID of the library containing the message template"),
        sendDate: z.string().optional().describe("Scheduled send date (ISO format). If omitted, sends immediately."),
        embeddedData: z.record(z.any()).optional().describe("Optional tags for distribution reporting; these are not survey-flow embedded data"),
      },
    },
    withErrorHandling("create_reminder", async (args) => {
      const data: Record<string, any> = {
        header: {
          fromEmail: args.fromEmail,
          fromName: args.fromName,
          replyToEmail: args.replyToEmail,
          subject: args.subject,
        },
        message: {
          libraryId: args.libraryId,
          messageId: args.messageId,
        },
      };
      if (args.sendDate) {
        data.sendDate = args.sendDate;
      }
      if (args.embeddedData) data.embeddedData = args.embeddedData;

      const result = await distributionApi.createReminder(args.distributionId, data);
      return toolSuccess({
        success: true,
        parentDistributionId: args.distributionId,
        reminderId: result.result?.distributionId ?? result.result?.id ?? null,
        message: args.sendDate
          ? `Reminder scheduled for ${args.sendDate}`
          : "Reminder created and sending",
        details: result.result,
      });
    })
  );

  // Create thank-you distribution
  server.registerTool(
    "create_thank_you",
    {
      description: "Send or schedule a thank-you email for respondents in an existing email distribution",
      annotations: { destructiveHint: false },
      inputSchema: {
        distributionId: z.string().min(1).describe("The parent distribution ID"),
        fromEmail: z.string().min(1).describe("Verified sender email address"),
        fromName: z.string().min(1).describe("From name displayed in the email"),
        replyToEmail: z.string().min(1).describe("Reply-to email address"),
        subject: z.string().min(1).describe("Thank-you email subject line"),
        messageId: z.string().min(1).describe("ID of the thank-you message template"),
        libraryId: z.string().min(1).describe("ID of the library containing the message template"),
        sendDate: z.string().optional().describe("Scheduled send date (ISO format); omit to send immediately"),
        embeddedData: z.record(z.any()).optional().describe("Optional tags for distribution reporting; these are not survey-flow embedded data"),
      },
    },
    withErrorHandling("create_thank_you", async (args) => {
      const data: Record<string, any> = {
        header: {
          fromEmail: args.fromEmail,
          fromName: args.fromName,
          replyToEmail: args.replyToEmail,
          subject: args.subject,
        },
        message: {
          libraryId: args.libraryId,
          messageId: args.messageId,
        },
      };
      if (args.sendDate) data.sendDate = args.sendDate;
      if (args.embeddedData) data.embeddedData = args.embeddedData;

      const result = await distributionApi.createThankYou(args.distributionId, data);
      return toolSuccess({
        success: true,
        parentDistributionId: args.distributionId,
        thankYouId: result.result?.distributionId ?? result.result?.id ?? null,
        message: args.sendDate
          ? `Thank-you email scheduled for ${args.sendDate}`
          : "Thank-you email created and sending",
        details: result.result,
      });
    })
  );
}
