import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { UserApi, userNextOffset } from "../services/user-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolSuccess, withErrorHandling } from "./_helpers.js";

export function registerUserTools(
  server: McpServer,
  client: QualtricsClient,
  _config: QualtricsConfig
) {
  const userApi = new UserApi(client);

  // List users
  server.registerTool(
    "list_users",
    {
      description: "List users in your Qualtrics organization",
      annotations: { readOnlyHint: true },
      inputSchema: {
        username: z.string().min(1).optional().describe("Filter by username"),
        offset: z.number().int().nonnegative().optional().describe("Starting offset from nextOffset (default: 0)"),
      },
    },
    withErrorHandling("list_users", async (args) => {
      const result = await userApi.listUsers(args.offset, args.username);
      const users = result.result?.elements || [];
      const nextPage = result.result?.nextPage ?? null;

      return toolSuccess({
        users: users.map((u: any) => ({
          id: u.id,
          username: u.username,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          userType: u.userType,
          accountStatus: u.accountStatus,
          lastLoginDate: u.lastLoginDate,
        })),
        returned: users.length,
        nextPage,
        nextOffset: userNextOffset(nextPage),
      });
    })
  );

  // Get user
  server.registerTool(
    "get_user",
    {
      description: "Get detailed information about a specific user",
      annotations: { readOnlyHint: true },
      inputSchema: {
        userId: z.string().min(1).describe("The user ID"),
      },
    },
    withErrorHandling("get_user", async (args) => {
      const result = await userApi.getUser(args.userId);
      return toolSuccess({
        user: result.result,
      });
    })
  );
}
