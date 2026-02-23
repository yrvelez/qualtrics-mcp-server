export interface MailingList {
  id: string;
  libraryId?: string;
  name: string;
  category?: string;
  folder?: string;
  contactCount?: number;
  lastModifiedDate?: string;
  creationDate?: string;
  ownerId?: string;
}

export interface Contact {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  language?: string;
  extRef?: string;
  embeddedData?: Record<string, any>;
  unsubscribed?: boolean;
  responseHistory?: any[];
  emailHistory?: any[];
}

export interface DirectoryContact {
  contactId: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  extRef?: string;
  language?: string;
  unsubscribed?: boolean;
  directoryId?: string;
  mailingListMembership?: Record<string, any>;
  embeddedData?: Record<string, any>;
}
