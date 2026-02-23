export interface Survey {
  id: string;
  name: string;
  ownerId: string;
  lastModified: string;
  creationDate: string;
  isActive: boolean;
}

export interface SurveyListResponse {
  result: {
    elements: Survey[];
    nextPage?: string;
    totalElements: number;
  };
}

export interface SurveyQuestion {
  QuestionID: string;
  QuestionText: string;
  QuestionType: string;
  Selector: string;
  SubSelector?: string;
  Choices?: Record<string, QuestionChoice>;
  ChoiceOrder?: string[];
  Validation?: Record<string, any>;
  QuestionDescription?: string;
  Configuration?: Record<string, any>;
}

export interface QuestionChoice {
  Display: string;
  TextEntry?: string;
  ExclusiveAnswer?: boolean;
}

export interface SurveyBlock {
  Type: string;
  Description: string;
  ID: string;
  BlockElements?: Array<{
    Type: string;
    QuestionID?: string;
  }>;
  Options?: Record<string, any>;
}

export interface SurveyDefinition {
  SurveyID: string;
  SurveyName: string;
  SurveyDescription?: string;
  SurveyStatus: string;
  Questions: Record<string, SurveyQuestion>;
  Blocks: Record<string, SurveyBlock>;
  SurveyFlow?: any;
  EmbeddedData?: any;
}
