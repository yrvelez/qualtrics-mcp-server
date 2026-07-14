#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createQualtricsServer } from "./server.js";

async function main() {
  try {
    const server = await createQualtricsServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

main();
