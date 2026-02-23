export interface QualtricsApiResponse<T> {
  result: T;
  meta: {
    requestId: string;
    httpStatus: string;
  };
}

export interface PaginatedResult<T> {
  elements: T[];
  nextPage?: string;
  totalElements?: number;
}

export interface ToolResult {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
