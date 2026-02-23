export interface Distribution {
  id: string;
  parentDistributionId?: string;
  ownerId: string;
  organizationId: string;
  requestStatus: string;
  requestType: string;
  sendDate?: string;
  createdDate: string;
  modifiedDate: string;
  headers?: Record<string, any>;
  recipients?: Record<string, any>;
  message?: Record<string, any>;
  surveyLink?: DistributionLink;
  stats?: {
    sent?: number;
    failed?: number;
    started?: number;
    bounced?: number;
    opened?: number;
    skipped?: number;
    finished?: number;
    complaints?: number;
    blocked?: number;
  };
}

export interface DistributionLink {
  surveyId: string;
  expirationDate?: string;
  linkType: string;
  url?: string;
}

export interface CreateDistributionPayload {
  surveyId: string;
  linkType: string;
  description: string;
  action: string;
  expirationDate?: string;
  mailingListId?: string;
  message?: {
    libraryId: string;
    messageId: string;
  };
  recipients?: {
    mailingListId: string;
  };
  header?: {
    fromEmail?: string;
    fromName?: string;
    replyToEmail?: string;
    subject?: string;
  };
  sendDate?: string;
}
