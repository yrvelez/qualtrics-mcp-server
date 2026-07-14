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

export function requireDeleteConfirmation(args: { confirmDelete?: boolean }): ToolResult | null {
  if (args.confirmDelete !== true) {
    return toolError("Destructive action: set confirmDelete to true to confirm deletion.");
  }
  return null;
}

export function withErrorHandling(
  name: string,
  handler: (args: any) => Promise<ToolResult>
): (args: any) => Promise<ToolResult> {
  return async (args: any) => {
    try {
      return await handler(args);
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      // Qualtrics error ESRV144: a question variation is incompatible with the
      // survey's New Survey Taking Experience (formerly Simple Layout).
      if (message.includes("incompatible with the accessible layout theme")) {
        message +=
          "\n\nHINT: This survey uses Qualtrics's New Survey Taking Experience (formerly Simple Layout). Current supported alternatives include Rank Order drag-and-drop (DND) and Constant Sum Choices/text entry (VRTL). Compatibility can vary by brand rollout; otherwise switch the survey to the legacy experience and retry.";
      }
      return toolError(`Error in ${name}: ${message}`);
    }
  };
}
