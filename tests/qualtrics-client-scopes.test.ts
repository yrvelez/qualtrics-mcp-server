import assert from "node:assert/strict";
import test from "node:test";
import type { QualtricsConfig } from "../src/config/settings.js";
import {
  QualtricsClient,
  type WriteScope,
} from "../src/services/qualtrics-client.js";

const config: QualtricsConfig = {
  qualtrics: {
    apiToken: "test-token",
    dataCenter: "test",
    baseUrl: "https://example.test/API/v3",
  },
  server: {
    readOnly: true,
    rateLimiting: { enabled: false, requestsPerMinute: 50 },
    timeout: 1_000,
  },
};

function clientWithScopes(scopes: WriteScope[]): QualtricsClient {
  const client = new QualtricsClient(config);
  client.writeScopes = new Set(scopes);
  return client;
}

function installFetchMock(t: test.TestContext): string[] {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ result: { ok: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return urls;
}

test("unmapped writes require the advanced fallback scope", async (t) => {
  const urls = installFetchMock(t);

  await assert.rejects(
    clientWithScopes([]).makeRequest(
      "/directories",
      { method: "POST", body: "{}" },
      "advanced"
    ),
    /Scope "advanced" is not enabled/
  );

  await assert.rejects(
    clientWithScopes(["advanced"]).makeRequest(
      "/directories",
      { method: "POST", body: "{}" }
    ),
    /No matching scope found/
  );

  await clientWithScopes(["advanced"]).makeRequest(
    "/directories",
    { method: "POST", body: "{}" },
    "advanced"
  );

  assert.deepEqual(urls, ["https://example.test/API/v3/directories"]);
});

test("mapped endpoints ignore advanced fallback and require least-privilege scopes", async (t) => {
  const urls = installFetchMock(t);
  const cases: Array<{
    endpoint: string;
    method: string;
    scope: WriteScope;
  }> = [
    { endpoint: "/survey-definitions/SV_1/questions", method: "POST", scope: "questionsAndBlocks" },
    { endpoint: "/survey-definitions/SV_1/blocks/BL_1", method: "PUT", scope: "questionsAndBlocks" },
    { endpoint: "/survey-definitions/SV_1/flow", method: "PUT", scope: "surveyDesign" },
    { endpoint: "/survey-definitions/SV_1/options", method: "PUT", scope: "surveyDesign" },
    { endpoint: "/surveys/SV_1/translations/EN", method: "PUT", scope: "surveyDesign" },
    { endpoint: "/survey-definitions/SV_1", method: "PUT", scope: "surveys" },
    { endpoint: "/directories/DIR_1/contacts", method: "POST", scope: "contacts" },
    { endpoint: "/directories/DIR_1/mailinglists/CG_1/transactioncontacts", method: "POST", scope: "contacts" },
    { endpoint: "/distributions/DIST_1", method: "DELETE", scope: "distributions" },
    { endpoint: "/users/USR_1", method: "PUT", scope: "users" },
  ];

  for (const { endpoint, method, scope } of cases) {
    await assert.rejects(
      clientWithScopes(["advanced"]).makeRequest(
        endpoint,
        { method },
        "advanced"
      ),
      new RegExp(`Scope "${scope}" is not enabled`),
      `${endpoint} should require ${scope}`
    );

    await clientWithScopes([scope]).makeRequest(
      endpoint,
      { method },
      "advanced"
    );
  }

  assert.equal(urls.length, cases.length);
});

test("scope routing uses exact normalized paths rather than matching substrings", async (t) => {
  const urls = installFetchMock(t);
  await assert.rejects(
    clientWithScopes(["surveys"]).makeRequest(
      "/unmapped/surveys/SV_1",
      { method: "DELETE" },
      "advanced"
    ),
    /Scope "advanced" is not enabled/
  );
  await clientWithScopes(["advanced"]).makeRequest(
    "/unmapped/surveys/SV_1",
    { method: "DELETE" },
    "advanced"
  );
  assert.equal(urls.length, 1);
});

test("documented side-effecting distribution-links GET requires write scope", async (t) => {
  const urls = installFetchMock(t);
  const endpoint = "/distributions/EMD_1/links?surveyId=SV_1";
  await assert.rejects(
    clientWithScopes([]).makeRequest(endpoint),
    /Scope "distributions" is not enabled/
  );
  await clientWithScopes(["distributions"]).makeRequest(endpoint);
  assert.deepEqual(urls, [`https://example.test/API/v3${endpoint}`]);
});

test("the response-export read exemption applies only to POST", async (t) => {
  const urls = installFetchMock(t);
  const endpoint = "/surveys/SV_1/export-responses";
  const client = clientWithScopes([]);

  await client.makeRequest(endpoint, { method: "POST", body: "{}" });
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    await assert.rejects(
      client.makeRequest(endpoint, { method }),
      /Scope "surveys" is not enabled/,
      `${method} must not inherit the POST read exemption`
    );
  }
  assert.deepEqual(urls, [`https://example.test/API/v3${endpoint}`]);
});

test("endpoint normalization cannot bypass least-privilege scope routing", async (t) => {
  const urls = installFetchMock(t);
  const client = clientWithScopes(["distributions"]);

  for (const endpoint of [
    "/distributions/../users/USR_1",
    "/distributions/%2e%2e/users/USR_1",
    "/distributions/%2Fusers/USR_1",
    "//other.example/API/v3/distributions/EMD_1",
    "/distributions/EMD_1/links/",
    "/distributions//EMD_1/links",
  ]) {
    await assert.rejects(
      client.makeRequest(endpoint, { method: "DELETE" }),
      /Invalid Qualtrics API endpoint/
    );
  }

  await assert.rejects(
    client.makeRequest("/distributions/EMD_1/not-links/../links?surveyId=SV_1"),
    /Invalid Qualtrics API endpoint/
  );
  assert.deepEqual(urls, []);
});
