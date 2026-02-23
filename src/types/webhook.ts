export interface EventSubscription {
  id: string;
  scope: string;
  topics: string;
  publicationUrl: string;
  encrypted: boolean;
  successfulPublications?: number;
}
