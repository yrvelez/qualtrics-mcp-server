import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QualtricsClient } from "../src/services/qualtrics-client.js";
import {
  DistributionApi,
  distributionNextSkipToken,
} from "../src/services/distribution-api.js";
import { UserApi, userNextOffset } from "../src/services/user-api.js";
import {
  anonymousSurveyUrl,
  registerDistributionTools,
} from "../src/tools/distribution-tools.js";
import { registerContactTools } from "../src/tools/contact-tools.js";
import { registerQuotaTools } from "../src/tools/quota-tools.js";
import { registerSurveyDesignTools } from "../src/tools/survey-design-tools.js";

async function connectedToolClient(
  register: (server: McpServer) => void
): Promise<{ server: McpServer; client: Client }> {
  const server = new McpServer({ name: "contract-test", version: "1.0.0" });
  register(server);
  const client = new Client({ name: "contract-test-client", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

test("distribution and user pagination use only documented current query fields", async () => {
  const endpoints: string[] = [];
  const fakeClient = {
    async makeRequest(endpoint: string) {
      endpoints.push(endpoint);
      return { result: { elements: [] } };
    },
  } as unknown as QualtricsClient;

  const distributions = new DistributionApi(fakeClient);
  await distributions.listDistributions("SV_1", {
    mailingListId: "CG_1",
    distributionRequestType: "Invite",
    pageSize: 25,
    skipToken: "next token",
  });
  const users = new UserApi(fakeClient);
  await users.listUsers(20, "person@example.com");

  assert.equal(
    endpoints[0],
    "/distributions?surveyId=SV_1&useNewPaginationScheme=true&mailingListId=CG_1&distributionRequestType=Invite&pageSize=25&skipToken=next+token"
  );
  assert.equal(
    endpoints[1],
    "/users?offset=20&username=person%40example.com"
  );
  assert.equal(endpoints[1].includes("limit="), false);
  assert.equal(
    distributionNextSkipToken("?skipToken=page%2B2"),
    "page+2"
  );
  assert.equal(userNextOffset("?offset=40"), 40);
  assert.equal(userNextOffset("?offset=-1"), null);
  assert.equal(userNextOffset("?offset=not-a-number"), null);
});

test("anonymous survey URL lookup performs no distribution write", async () => {
  let definitionReads = 0;
  const fakeClient = {
    async getSurveyDefinition(surveyId: string) {
      definitionReads++;
      assert.equal(surveyId, "SV_1");
      return { result: { BrandBaseURL: "brand.qualtrics.com" } };
    },
    async makeRequest() {
      throw new Error("unexpected distribution API call");
    },
  } as unknown as QualtricsClient;

  const { server, client } = await connectedToolClient((target) =>
    registerDistributionTools(target, fakeClient, {} as never)
  );
  try {
    const result = await client.callTool({
      name: "create_anonymous_link",
      arguments: { surveyId: "SV_1" },
    });
    assert.notEqual(result.isError, true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.anonymousUrl, "https://brand.qualtrics.com/jfe/form/SV_1");
    assert.equal(body.distributionId, null);
    assert.equal(definitionReads, 1);
  } finally {
    await client.close();
    await server.close();
  }

  assert.equal(
    anonymousSurveyUrl("https://brand.qualtrics.com/some/path", "SV_2"),
    "https://brand.qualtrics.com/jfe/form/SV_2"
  );
  assert.throws(
    () => anonymousSurveyUrl("http://brand.qualtrics.com", "SV_2"),
    /non-HTTPS/
  );
});

test("survey language updates merge through the complete survey-options resource", async () => {
  const calls: Array<{ endpoint: string; options: RequestInit }> = [];
  const fakeClient = {
    async makeRequest(endpoint: string, options: RequestInit = {}) {
      calls.push({ endpoint, options });
      if (options.method === undefined) {
        return {
          result: {
            SurveyTitle: "Preserve me",
            AvailableLanguages: {
              EN: { enabled: true },
              ES: { enabled: true, translated: false },
            },
          },
        };
      }
      return { result: { ok: true } };
    },
  } as unknown as QualtricsClient;

  const { server, client } = await connectedToolClient((target) =>
    registerSurveyDesignTools(target, fakeClient, {} as never)
  );
  try {
    const result = await client.callTool({
      name: "update_survey_languages",
      arguments: {
        surveyId: "SV_1",
        availableLanguages: {
          ES: { translated: true },
          FR: { enabled: true },
        },
      },
    });
    assert.notEqual(result.isError, true);
  } finally {
    await client.close();
    await server.close();
  }

  assert.equal(calls[0].endpoint, "/survey-definitions/SV_1/options");
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[1].endpoint, "/survey-definitions/SV_1/options");
  assert.equal(calls[1].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[1].options.body as string), {
    SurveyTitle: "Preserve me",
    AvailableLanguages: {
      EN: { enabled: true },
      ES: { enabled: true, translated: true },
      FR: { enabled: true },
    },
  });
  assert.equal(calls.some((call) => call.endpoint.endsWith("/languages")), false);
});

test("quota-group deletion requires both delete and cascade acknowledgements", async () => {
  const calls: Array<{ endpoint: string; options: RequestInit }> = [];
  const fakeClient = {
    async makeRequest(endpoint: string, options: RequestInit = {}) {
      calls.push({ endpoint, options });
      return { result: {} };
    },
  } as unknown as QualtricsClient;

  const { server, client } = await connectedToolClient((target) =>
    registerQuotaTools(target, fakeClient, {} as never)
  );
  try {
    const noDelete = await client.callTool({
      name: "delete_quota_group",
      arguments: {
        surveyId: "SV_1",
        quotaGroupId: "QG_1",
        confirmDelete: false,
        confirmCascade: true,
      },
    });
    assert.equal(noDelete.isError, true);

    const noCascade = await client.callTool({
      name: "delete_quota_group",
      arguments: {
        surveyId: "SV_1",
        quotaGroupId: "QG_1",
        confirmDelete: true,
        confirmCascade: false,
      },
    });
    assert.equal(noCascade.isError, true);
    assert.equal(calls.length, 0);

    const confirmed = await client.callTool({
      name: "delete_quota_group",
      arguments: {
        surveyId: "SV_1",
        quotaGroupId: "QG_1",
        confirmDelete: true,
        confirmCascade: true,
      },
    });
    assert.notEqual(confirmed.isError, true);
  } finally {
    await client.close();
    await server.close();
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, "/survey-definitions/SV_1/quotagroups/QG_1");
  assert.equal(calls[0].options.method, "DELETE");
});

test("contact creation supports configured non-email identity fields", async () => {
  const calls: Array<{ endpoint: string; options: RequestInit }> = [];
  const fakeClient = {
    async makeRequest(endpoint: string, options: RequestInit = {}) {
      calls.push({ endpoint, options });
      return { result: { contactId: "CID_1" } };
    },
  } as unknown as QualtricsClient;

  const { server, client } = await connectedToolClient((target) =>
    registerContactTools(target, fakeClient, {} as never)
  );
  try {
    const externalIdentity = await client.callTool({
      name: "add_contact",
      arguments: {
        directoryId: "POOL_1",
        mailingListId: "CG_1",
        externalDataReference: "participant-42",
      },
    });
    assert.notEqual(externalIdentity.isError, true);
    assert.deepEqual(JSON.parse(calls[0].options.body as string), {
      extRef: "participant-42",
    });

    const missingIdentity = await client.callTool({
      name: "add_contact",
      arguments: {
        directoryId: "POOL_1",
        mailingListId: "CG_1",
      },
    });
    assert.equal(missingIdentity.isError, true);

    const invalidBulk = await client.callTool({
      name: "bulk_import_contacts",
      arguments: {
        directoryId: "POOL_1",
        mailingListId: "CG_1",
        contacts: [{}],
      },
    });
    assert.equal(invalidBulk.isError, true);
    assert.equal(calls.length, 1);
  } finally {
    await client.close();
    await server.close();
  }
});
