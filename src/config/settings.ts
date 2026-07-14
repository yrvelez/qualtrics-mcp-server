import { z } from "zod";

const ConfigSchema = z.object({
  qualtrics: z.object({
    apiToken: z.string().min(1),
    dataCenter: z.string().min(1),
    baseUrl: z.string().optional(),
  }),
  server: z.object({
    readOnly: z.boolean().default(true),
    rateLimiting: z.object({
      enabled: z.boolean().default(true),
      requestsPerMinute: z.number().int().positive().default(50),
    }),
    timeout: z.number().int().positive().default(30000),
  }),
});

export type QualtricsConfig = z.infer<typeof ConfigSchema>;

const ENV_HELP: Record<string, { env: string; help: string }> = {
  "qualtrics.apiToken": {
    env: "QUALTRICS_API_TOKEN",
    help: "Your Qualtrics API token. Find it at: Account Settings > Qualtrics IDs > API",
  },
  "qualtrics.dataCenter": {
    env: "QUALTRICS_DATA_CENTER",
    help: 'Your data center ID (e.g. "yul1", "iad1"). Find it in your Qualtrics account URL: https://<datacenter>.qualtrics.com',
  },
};

export async function loadConfig(): Promise<QualtricsConfig> {
  const config = {
    qualtrics: {
      apiToken: process.env.QUALTRICS_API_TOKEN,
      dataCenter: process.env.QUALTRICS_DATA_CENTER,
      baseUrl: process.env.QUALTRICS_BASE_URL,
    },
    server: {
      readOnly: process.env.QUALTRICS_READ_ONLY !== "false",
      rateLimiting: {
        enabled: process.env.RATE_LIMITING_ENABLED !== "false",
        requestsPerMinute: parseInt(process.env.RATE_LIMIT_RPM || "50"),
      },
      timeout: parseInt(process.env.REQUEST_TIMEOUT || "30000"),
    },
  };

  const result = ConfigSchema.safeParse(config);

  if (result.success) {
    return result.data;
  }

  const missing = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    const info = ENV_HELP[path];
    if (info) {
      return `  ${info.env}  —  ${info.help}`;
    }
    return `  ${path}`;
  });

  const message = [
    "",
    "Qualtrics MCP Server — missing configuration",
    "",
    "Set the following environment variables:",
    "",
    ...missing,
    "",
    "Quick start:",
    '  1. Copy .env.example to .env  →  cp .env.example .env',
    "  2. Fill in your values         →  open .env",
    "  3. Run again                   →  pnpm start",
    "",
  ].join("\n");

  throw new Error(message);
}
