import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { UserApi } from "../services/user-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolSuccess, withErrorHandling } from "./_helpers.js";

export function registerUserTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const userApi = new UserApi(client);

  // List users
  server.tool(
    "list_users",
    "List users in your Qualtrics organization",
    {
      limit: z.number().optional().describe("Maximum number of users to return"),
      offset: z.number().optional().describe("Starting offset for pagination"),
    },
    withErrorHandling("list_users", async (args) => {
      const result = await userApi.listUsers(args.offset, args.limit);
      const users = result.result.elements || [];

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
        total: users.length,
      });
    })
  );

  // Get user
  server.tool(
    "get_user",
    "Get detailed information about a specific user",
    {
      userId: z.string().min(1).describe("The user ID"),
    },
    withErrorHandling("get_user", async (args) => {
      const result = await userApi.getUser(args.userId);
      return toolSuccess({
        user: result.result,
      });
    })
  );
}
