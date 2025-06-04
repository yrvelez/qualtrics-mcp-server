import { z } from "zod";

const ConfigSchema = z.object({
  qualtrics: z.object({
    apiToken: z.string().min(1, "Qualtrics API token is required"),
    dataCenter: z.string().min(1, "Qualtrics data center ID is required"),
    baseUrl: z.string().optional(),
  }),
  server: z.object({
    rateLimiting: z.object({
      enabled: z.boolean().default(true),
      requestsPerMinute: z.number().default(50),
    }),
    timeout: z.number().default(30000),
  }),
});

export type QualtricsConfig = z.infer<typeof ConfigSchema>;

export async function loadConfig(): Promise<QualtricsConfig> {
  const config = {
    qualtrics: {
      apiToken: process.env.QUALTRICS_API_TOKEN,
      dataCenter: process.env.QUALTRICS_DATA_CENTER || "yourdatacenterid",
      baseUrl: process.env.QUALTRICS_BASE_URL,
    },
    server: {
      rateLimiting: {
        enabled: process.env.RATE_LIMITING_ENABLED !== "false",
        requestsPerMinute: parseInt(process.env.RATE_LIMIT_RPM || "50"),
      },
      timeout: parseInt(process.env.REQUEST_TIMEOUT || "30000"),
    },
  };

  try {
    return ConfigSchema.parse(config);
  } catch (error) {
    console.error("Configuration validation failed:", error);
    throw new Error("Invalid configuration. Please check your environment variables.");
  }
}