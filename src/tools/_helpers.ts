import type { ToolResult } from "../types/index.js";

export function toolError(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function toolSuccess(data: unknown): ToolResult {
  return {
    content: [{
      type: "text",
      text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
    }],
  };
}

export function withErrorHandling(
  name: string,
  handler: (args: any) => Promise<ToolResult>
): (args: any) => Promise<ToolResult> {
  return async (args: any) => {
    try {
      return await handler(args);
    } catch (error) {
      return toolError(
        `Error in ${name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
