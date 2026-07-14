import { QualtricsConfig } from "../config/settings.js";
import { RateLimiter } from "./rate-limiter.js";
import type { Survey, SurveyListResponse, ResponseExportJob } from "../types/index.js";

export type { Survey, SurveyListResponse, ResponseExportJob };

/**
 * Scoped write categories grouped by risk level.
 *
 * HIGH RISK (unrecoverable):
 *   "users" — user account management
 *   "contacts" — mailing lists and contacts
 *   "surveys" — survey-level create/update/delete
 *
 * MEDIUM RISK (annoying but reprogrammable):
 *   "surveyDesign" — flows, embedded data, web services
 *
 * LOW RISK (deleted items go to trash):
 *   "questionsAndBlocks" — questions and blocks within surveys
 *
 * MINIMAL RISK:
 *   "distributions" — distributions and links
 */
export type WriteScope =
  | "users"
  | "contacts"
  | "surveys"
  | "surveyDesign"
  | "questionsAndBlocks"
  | "distributions"
  | "libraries"
  | "advanced";

export const ALL_WRITE_SCOPES: WriteScope[] = [
  "users",
  "contacts",
  "surveys",
  "surveyDesign",
  "questionsAndBlocks",
  "distributions",
  "libraries",
  "advanced",
];

export type RiskLevel = "HIGH" | "MEDIUM" | "LOW" | "MINIMAL";

interface ScopeInfo {
  description: string;
  risk: RiskLevel;
  riskNote: string;
}

const SCOPE_INFO: Record<WriteScope, ScopeInfo> = {
  users:             { description: "Create and update user accounts", risk: "HIGH", riskNote: "Account-level changes, unrecoverable" },
  contacts:          { description: "Create, update, and delete mailing lists and contacts", risk: "HIGH", riskNote: "Deleted contacts cannot be recovered" },
  surveys:           { description: "Create, update, and delete entire surveys", risk: "HIGH", riskNote: "Deleted surveys cannot be recovered" },
  surveyDesign:      { description: "Modify flow, quotas, options, versions, languages, translations, and webhooks", risk: "MEDIUM", riskNote: "Annoying but reprogrammable" },
  questionsAndBlocks: { description: "Create, update, and delete questions and blocks", risk: "LOW", riskNote: "Deleted items go to survey trash" },
  distributions:     { description: "Create and manage distributions and links", risk: "MINIMAL", riskNote: "Low impact" },
  libraries:         { description: "Create and delete reusable library messages and graphics", risk: "MEDIUM", riskNote: "Changes can affect future surveys and distributions" },
  advanced:          { description: "Call otherwise-unmapped Qualtrics API write endpoints", risk: "HIGH", riskNote: "Impact depends on the endpoint and may be irreversible" },
};

const SCOPE_DESCRIPTIONS: Record<WriteScope, string> = Object.fromEntries(
  ALL_WRITE_SCOPES.map(s => [s, SCOPE_INFO[s].description])
) as Record<WriteScope, string>;

/** Map endpoint patterns to their write scope. Order matters — first match wins. */
const ENDPOINT_SCOPE_RULES: Array<{ pattern: RegExp; scope: WriteScope }> = [
  // questionsAndBlocks: questions and blocks within surveys (LOW risk — trash recoverable)
  { pattern: /^\/survey-definitions\/[^/]+\/questions(?:\/[^/]+)?$/, scope: "questionsAndBlocks" },
  { pattern: /^\/survey-definitions\/[^/]+\/blocks(?:\/[^/]+)?$/, scope: "questionsAndBlocks" },
  // surveyDesign: questionnaire configuration (MEDIUM risk — reprogrammable)
  { pattern: /^\/survey-definitions\/[^/]+\/flow(?:\/[^/]+)?$/, scope: "surveyDesign" },
  { pattern: /^\/survey-definitions\/[^/]+\/(?:options|versions|quotas|quotagroups)(?:\/[^/]+)?$/, scope: "surveyDesign" },
  { pattern: /^\/surveys\/[^/]+\/translations\/[^/]+$/, scope: "surveyDesign" },
  { pattern: /^\/eventsubscriptions(?:\/[^/]+)?$/, scope: "surveyDesign" },
  // surveys: survey-level CRUD (HIGH risk — unrecoverable)
  { pattern: /^\/survey-definitions(?:\/[^/]+(?:\/metadata)?)?$/, scope: "surveys" },
  { pattern: /^\/surveys(?:\/.*)?$/, scope: "surveys" },
  // contacts & mailing lists (HIGH risk — unrecoverable)
  { pattern: /^\/mailinglists(?:\/.*)?$/, scope: "contacts" },
  { pattern: /^\/directories\/[^/]+\/(?:contacts|mailinglists|transactioncontacts)(?:\/.*)?$/, scope: "contacts" },
  // distributions (MINIMAL risk)
  { pattern: /^\/distributions(?:\/.*)?$/, scope: "distributions" },
  // reusable library content (MEDIUM risk)
  { pattern: /^\/libraries(?:\/.*)?$/, scope: "libraries" },
  // users (HIGH risk — account-level)
  { pattern: /^\/users(?:\/.*)?$/, scope: "users" },
];

function endpointPathname(endpoint: string): string {
  const queryStart = endpoint.indexOf("?");
  return queryStart === -1 ? endpoint : endpoint.slice(0, queryStart);
}

/**
 * Reject endpoint strings that a URL parser or HTTP server could reinterpret
 * after scope resolution. Qualtrics API path segments use plain IDs and do not
 * require percent encoding; query values must be encoded with URLSearchParams.
 */
function checkedEndpointPathname(endpoint: string): string {
  const pathname = endpointPathname(endpoint);
  if (
    !endpoint.startsWith("/") ||
    endpoint.startsWith("//") ||
    endpoint.includes("#") ||
    pathname.includes("//") ||
    (pathname.length > 1 && pathname.endsWith("/")) ||
    pathname.includes("\\") ||
    pathname.includes("%") ||
    /\s/.test(pathname) ||
    pathname.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      "Invalid Qualtrics API endpoint: use a root-relative path with plain path segments and separately encoded query values."
    );
  }

  const parsed = new URL(endpoint, "https://qualtrics.invalid");
  if (
    parsed.origin !== "https://qualtrics.invalid" ||
    parsed.pathname !== pathname
  ) {
    throw new Error(
      "Invalid Qualtrics API endpoint: URL normalization would change the requested path."
    );
  }
  return pathname;
}

function resolveScope(endpoint: string): WriteScope | null {
  const pathname = endpointPathname(endpoint);
  for (const rule of ENDPOINT_SCOPE_RULES) {
    if (rule.pattern.test(pathname)) {
      return rule.scope;
    }
  }
  return null;
}

export class QualtricsClient {
  private baseUrl: string;
  private apiToken: string;
  private rateLimiter: RateLimiter;
  private timeout: number;

  /**
   * Set of scopes that are allowed to perform write operations.
   * Empty set = fully read-only. All scopes present = fully read-write.
   */
  public writeScopes: Set<WriteScope>;

  /** Backwards-compatible getter. */
  public get readOnly(): boolean {
    return this.writeScopes.size === 0;
  }

  /** Backwards-compatible setter: true clears all scopes, false grants all. */
  public set readOnly(value: boolean) {
    if (value) {
      this.writeScopes.clear();
    } else {
      this.writeScopes = new Set(ALL_WRITE_SCOPES);
    }
  }

  /** Endpoints that use POST but are actually read operations. */
  private static readonly READ_ONLY_POST_ALLOWLIST = [
    /^\/surveys\/[^/]+\/export-responses$/,
  ];

  /** GET endpoints that Qualtrics documents as mutating account state. */
  private static readonly SIDE_EFFECTING_GET_ENDPOINTS = [
    /^\/distributions\/[^/]+\/links$/,
  ];

  constructor(config: QualtricsConfig) {
    this.baseUrl = (config.qualtrics.baseUrl ||
      `https://${config.qualtrics.dataCenter}.qualtrics.com/API/v3`)
      .replace(/\/+$/, "");
    this.apiToken = config.qualtrics.apiToken;
    this.rateLimiter = new RateLimiter(config.server.rateLimiting);
    this.timeout = config.server.timeout;
    this.writeScopes = config.server.readOnly ? new Set() : new Set(ALL_WRITE_SCOPES);
  }

  public async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    fallbackWriteScope?: WriteScope
  ): Promise<T> {
    const method = (options.method ?? "GET").toUpperCase();
    const pathname = checkedEndpointPathname(endpoint);
    const isSideEffectingGet = method === "GET" &&
      QualtricsClient.SIDE_EFFECTING_GET_ENDPOINTS.some((pattern) =>
        pattern.test(pathname)
      );
    if (method !== "GET" || isSideEffectingGet) {
      const isAllowlisted = method === "POST" &&
        QualtricsClient.READ_ONLY_POST_ALLOWLIST.some(
          (pattern) => pattern.test(pathname)
        );
      if (!isAllowlisted) {
        this.assertWriteAccess(endpoint, fallbackWriteScope, method);
      }
    }

    await this.rateLimiter.checkLimit();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers = new Headers(options.headers);
      headers.set("X-API-TOKEN", this.apiToken);
      if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Qualtrics API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      if (response.status === 204) return undefined as T;

      const responseText = await response.text();
      if (!responseText) return undefined as T;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("json")) {
        return JSON.parse(responseText) as T;
      }
      return responseText as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    } finally {
      // Keep the abort active while the response body is consumed as well as
      // while waiting for headers.
      clearTimeout(timeoutId);
    }
  }

  /** Enforce scoped permission for side-effecting GETs or custom workflows. */
  public assertWriteAccess(
    endpoint: string,
    fallbackWriteScope?: WriteScope,
    method = "GET"
  ): void {
    // Known endpoints always use their least-privilege mapped scope. The
    // fallback is only for intentionally exposed, otherwise-unmapped API
    // operations (see the advanced request tool).
    checkedEndpointPathname(endpoint);
    const scope = resolveScope(endpoint) ?? fallbackWriteScope ?? null;
    if (scope === null || !this.writeScopes.has(scope)) {
      const scopeHint = scope
        ? ` Enable the "${scope}" scope to allow this operation.`
        : "";
      throw new Error(
        `Write blocked: ${method} ${endpoint}. ${scope ? `Scope "${scope}" is not enabled.` : "No matching scope found."}${scopeHint}`
      );
    }
  }

  async getSurveys(offset = 0): Promise<SurveyListResponse> {
    const params = new URLSearchParams({ offset: String(offset) });
    return this.makeRequest(`/surveys?${params.toString()}`);
  }

  async getSurvey(surveyId: string): Promise<any> {
    return this.makeRequest(`/surveys/${encodeURIComponent(surveyId)}`);
  }

  async getSurveyDefinition(surveyId: string): Promise<any> {
    return this.makeRequest(`/survey-definitions/${encodeURIComponent(surveyId)}`);
  }

  async createSurvey(surveyData: any): Promise<any> {
    return this.makeRequest("/survey-definitions", {
      method: "POST",
      body: JSON.stringify(surveyData),
    });
  }

  async startResponseExport(surveyId: string, format: string = "json", filters?: any): Promise<ResponseExportJob> {
    const requestBody: any = {
      format: format,
      compress: false,
    };

    // Add filters if provided
    if (filters) {
      Object.assign(requestBody, filters);
    }

    return this.makeRequest(`/surveys/${encodeURIComponent(surveyId)}/export-responses`, {
      method: "POST",
      body: JSON.stringify(requestBody),
    });
  }

  async getResponseExportProgress(surveyId: string, exportProgressId: string): Promise<any> {
    return this.makeRequest(`/surveys/${encodeURIComponent(surveyId)}/export-responses/${encodeURIComponent(exportProgressId)}`);
  }

  async *downloadResponseExportChunks(
    surveyId: string,
    fileId: string
  ): AsyncGenerator<Uint8Array> {
    const endpoint =
      `/surveys/${encodeURIComponent(surveyId)}/export-responses/` +
      `${encodeURIComponent(fileId)}/file`;
    checkedEndpointPathname(endpoint);
    await this.rateLimiter.checkLimit();

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const armInactivityTimeout = (): void => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(), this.timeout);
    };
    const clearInactivityTimeout = (): void => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      timeoutId = undefined;
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let completed = false;
    try {
      // Bound the wait for response headers. Once streaming begins, the same
      // timeout is applied to each read independently so a healthy large
      // export is not aborted merely because its total transfer exceeds it.
      armInactivityTimeout();
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          "X-API-TOKEN": this.apiToken,
          Accept: "application/octet-stream",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Qualtrics API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }
      if (!response.body) {
        throw new Error("Qualtrics response export download returned no body.");
      }

      clearInactivityTimeout();
      reader = response.body.getReader();
      while (true) {
        armInactivityTimeout();
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          next = await reader.read();
        } finally {
          // Do not leave a timer running while the async generator is paused
          // at yield and the consumer is processing or writing the chunk.
          clearInactivityTimeout();
        }
        const { done, value } = next;
        if (done) {
          completed = true;
          break;
        }
        if (value) yield value;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          "Response export download timed out waiting for headers or the next data chunk."
        );
      }
      throw error;
    } finally {
      clearInactivityTimeout();
      if (reader) {
        if (!completed) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (!completed) controller.abort();
    }
  }

  async downloadResponseExportFile(surveyId: string, fileId: string): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.downloadResponseExportChunks(surveyId, fileId)) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  /** Get a human-readable summary of current write permissions. */
  public getScopesSummary(): string {
    if (this.writeScopes.size === 0) {
      return "READ-ONLY (no write scopes enabled)";
    }
    if (this.writeScopes.size === ALL_WRITE_SCOPES.length) {
      return "READ-WRITE (all scopes enabled)";
    }
    const enabled = ALL_WRITE_SCOPES.filter(s => this.writeScopes.has(s));
    const lines = enabled.map(s => `  ✓ ${s} [${SCOPE_INFO[s].risk} risk]: ${SCOPE_INFO[s].description} — ${SCOPE_INFO[s].riskNote}`);
    return `SCOPED WRITE (${enabled.length}/${ALL_WRITE_SCOPES.length} scopes enabled):\n${lines.join("\n")}`;
  }

  /** Get descriptions for all scopes. */
  public static getScopeDescriptions(): Record<WriteScope, string> {
    return { ...SCOPE_DESCRIPTIONS };
  }

  /** Get full scope info including risk levels. */
  public static getScopeInfo(): Record<WriteScope, ScopeInfo> {
    return { ...SCOPE_INFO };
  }
}
