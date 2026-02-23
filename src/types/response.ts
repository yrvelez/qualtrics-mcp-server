export interface ResponseExportJob {
  result: {
    progressId: string;
    percentComplete: number;
    status: string;
  };
}

export interface SurveyResponse {
  responseId: string;
  values: Record<string, any>;
  labels?: Record<string, any>;
  displayedFields?: string[];
  displayedValues?: Record<string, any>;
}

export interface CreateResponsePayload {
  values: Record<string, any>;
  embeddedData?: Record<string, any>;
}
