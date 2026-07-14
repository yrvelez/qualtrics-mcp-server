import { QualtricsClient } from "./qualtrics-client.js";

export type SurveyVersionFormat = "json" | "qsf";

export class SurveyDesignApi {
  constructor(private client: QualtricsClient) {}

  async getSurveyMetadata(surveyId: string): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${this.segment(surveyId)}/metadata`
    );
  }

  async updateSurveyMetadata(
    surveyId: string,
    data: Record<string, any>
  ): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${this.segment(surveyId)}/metadata`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );
  }

  async getSurveyOptions(surveyId: string): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${this.segment(surveyId)}/options`
    );
  }

  async updateSurveyOptions(
    surveyId: string,
    data: Record<string, any>
  ): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${this.segment(surveyId)}/options`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );
  }

  async listSurveyVersions(surveyId: string): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${this.segment(surveyId)}/versions`
    );
  }

  async getSurveyVersion(
    surveyId: string,
    versionId: string,
    format?: SurveyVersionFormat
  ): Promise<any> {
    const query = format ? `?format=${encodeURIComponent(format)}` : "";
    return this.client.makeRequest(
      `/survey-definitions/${this.segment(surveyId)}/versions/${this.segment(versionId)}${query}`
    );
  }

  async createSurveyVersion(
    surveyId: string,
    data: Record<string, any>
  ): Promise<any> {
    return this.client.makeRequest(
      `/survey-definitions/${this.segment(surveyId)}/versions`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  }

  async getSurveyLanguages(surveyId: string): Promise<any> {
    return this.client.makeRequest(
      `/surveys/${this.segment(surveyId)}/languages`
    );
  }

  async getSurveyTranslations(
    surveyId: string,
    languageCode: string
  ): Promise<any> {
    return this.client.makeRequest(
      `/surveys/${this.segment(surveyId)}/translations/${this.segment(languageCode)}`
    );
  }

  async updateSurveyTranslations(
    surveyId: string,
    languageCode: string,
    data: Record<string, any>
  ): Promise<any> {
    return this.client.makeRequest(
      `/surveys/${this.segment(surveyId)}/translations/${this.segment(languageCode)}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );
  }

  private segment(value: string): string {
    return encodeURIComponent(value);
  }
}
