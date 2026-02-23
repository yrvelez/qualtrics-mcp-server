export interface QualtricsUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  userType: string;
  organizationId: string;
  language?: string;
  accountStatus: string;
  accountCreationDate?: string;
  lastLoginDate?: string;
  timeZone?: string;
  divisionId?: string;
  permissions?: Record<string, any>;
}
