import assert from "node:assert/strict";
import test from "node:test";
import type { QualtricsClient } from "../src/services/qualtrics-client.js";
import { SurveyImportApi } from "../src/services/survey-import-api.js";

type RequestCall = {
  endpoint: string;
  options: RequestInit;
};

function importApiWithCalls(): { api: SurveyImportApi; calls: RequestCall[] } {
  const calls: RequestCall[] = [];
  const client = {
    async makeRequest(endpoint: string, options: RequestInit) {
      calls.push({ endpoint, options });
      return { result: { id: "SV_test" } };
    },
  } as unknown as QualtricsClient;

  return { api: new SurveyImportApi(client), calls };
}

test("copySurvey sends Qualtrics copy headers and multipart form data", async () => {
  const { api, calls } = importApiWithCalls();

  await api.copySurvey("SV_source", "Copied Study", "UR_destination");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, "/surveys");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, {
    "X-COPY-SOURCE": "SV_source",
    "X-COPY-DESTINATION-OWNER": "UR_destination",
  });
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.body.get("name"), "Copied Study");
});

test("importContent builds a named file part without forcing a JSON content type", async () => {
  const { api, calls } = importApiWithCalls();
  const qsf = new Blob([JSON.stringify({ SurveyEntry: { SurveyName: "Study" } })], {
    type: SurveyImportApi.mimeType("qsf"),
  });

  await api.importContent("My Study!", "qsf", qsf);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, "/surveys");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers, undefined);
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.body.get("name"), "My Study!");

  const file = calls[0].options.body.get("file");
  assert.ok(file instanceof Blob);
  assert.equal(file.type, "application/vnd.qualtrics.survey.qsf");
  assert.equal((file as Blob & { name?: string }).name, "My_Study_.qsf");
  assert.match(await file.text(), /"SurveyName":"Study"/);
});

test("importFromUrl sends the format MIME type and source URL as form fields", async () => {
  const { api, calls } = importApiWithCalls();

  await api.importFromUrl(
    "Imported Instrument",
    "docx",
    "https://example.test/instrument.docx?signature=abc"
  );

  assert.equal(calls.length, 1);
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.body.get("name"), "Imported Instrument");
  assert.equal(
    calls[0].options.body.get("contentType"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  assert.equal(
    calls[0].options.body.get("fileUrl"),
    "https://example.test/instrument.docx?signature=abc"
  );
});
