import assert from "node:assert/strict";
import test from "node:test";
import type { QualtricsClient } from "../src/services/qualtrics-client.js";
import {
  ContactApi,
  contactNextSkipToken,
} from "../src/services/contact-api.js";

interface CapturedCall {
  endpoint: string;
  options: RequestInit;
}

function capturingClient(calls: CapturedCall[]): QualtricsClient {
  return {
    async makeRequest(endpoint: string, options: RequestInit = {}) {
      calls.push({ endpoint, options });
      return { result: { id: `ID_${calls.length}` } };
    },
  } as unknown as QualtricsClient;
}

test("directory discovery lists pools with optional cursor pagination", async () => {
  const calls: CapturedCall[] = [];
  const api = new ContactApi(capturingClient(calls));

  await api.listDirectories();
  await api.listDirectories({ pageSize: 100, skipToken: "next+token" });

  assert.equal(calls[0].endpoint, "/directories");
  assert.equal(
    calls[1].endpoint,
    "/directories?pageSize=100&skipToken=next%2Btoken"
  );
  assert.equal(calls[0].options.method, undefined);
});

test("XM Directory mailing-list routes use current cursor pagination and CRUD contracts", async () => {
  const calls: CapturedCall[] = [];
  const api = new ContactApi(capturingClient(calls));

  await api.listMailingLists({
    directoryId: "POOL_1",
    ownerId: "UR owner",
    pageSize: 100,
    skipToken: "next+token",
    includeCount: true,
  });
  await api.getMailingList("CG_1", "POOL_1", true);
  await api.createMailingList({ name: "Study panel" }, "POOL_1");
  await api.updateMailingList("CG_1", { name: "Renamed" }, "POOL_1");
  await api.deleteMailingList("CG_1", "POOL_1");

  assert.equal(
    calls[0].endpoint,
    "/directories/POOL_1/mailinglists?ownerId=UR+owner&pageSize=100&skipToken=next%2Btoken&includeCount=true&useNewPaginationScheme=true"
  );
  assert.equal(
    calls[1].endpoint,
    "/directories/POOL_1/mailinglists/CG_1?includeCount=true"
  );
  assert.equal(calls[2].endpoint, "/directories/POOL_1/mailinglists");
  assert.equal(calls[2].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[2].options.body as string), {
    name: "Study panel",
  });
  assert.equal(calls[3].endpoint, "/directories/POOL_1/mailinglists/CG_1");
  assert.equal(calls[3].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[3].options.body as string), {
    name: "Renamed",
  });
  assert.equal(calls[4].options.method, "DELETE");
  for (const call of calls) {
    assert.equal(call.endpoint.startsWith("/mailinglists"), false);
  }
});

test("XM Directory contact routes cover list and single-contact CRUD", async () => {
  const calls: CapturedCall[] = [];
  const api = new ContactApi(capturingClient(calls));

  await api.listContacts("CG_1", {
    directoryId: "POOL_1",
    pageSize: 50,
    skipToken: "cursor value",
    includeEmbedded: true,
  });
  await api.getContact("CG_1", "CID_1", "POOL_1");
  await api.createContact("CG_1", { email: "person@example.com" }, "POOL_1");
  await api.updateContact("CG_1", "CID_1", { unsubscribed: false }, "POOL_1");
  await api.deleteContact("CG_1", "CID_1", "POOL_1");

  assert.equal(
    calls[0].endpoint,
    "/directories/POOL_1/mailinglists/CG_1/contacts?pageSize=50&skipToken=cursor+value&includeEmbedded=true&useNewPaginationScheme=true"
  );
  assert.equal(
    calls[1].endpoint,
    "/directories/POOL_1/mailinglists/CG_1/contacts/CID_1"
  );
  assert.equal(calls[1].options.method, undefined);
  assert.equal(calls[2].options.method, "POST");
  assert.equal(calls[3].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[3].options.body as string), {
    unsubscribed: false,
  });
  assert.equal(calls[4].options.method, "DELETE");
});

test("XM cursor helpers accept URL, query-relative, bare, and terminal values", () => {
  assert.equal(contactNextSkipToken(null), null);
  assert.equal(contactNextSkipToken("opaque-token"), "opaque-token");
  assert.equal(contactNextSkipToken("?skipToken=next%2Btoken"), "next+token");
  assert.equal(
    contactNextSkipToken(
      "https://example.test/API/v3/directories/POOL_1/mailinglists?skipToken=page-2"
    ),
    "page-2"
  );
});

test("bounded bulk contact creation reports partial failures by input index", async () => {
  let attempt = 0;
  const fakeClient = {
    async makeRequest(_endpoint: string, options: RequestInit = {}) {
      attempt++;
      const body = JSON.parse(options.body as string);
      if (attempt === 2) throw new Error("duplicate contact");
      return { result: { contactId: `CID_${attempt}`, email: body.email } };
    },
  } as unknown as QualtricsClient;
  const api = new ContactApi(fakeClient);

  const result = await api.bulkImportContacts(
    "CG_1",
    [
      { email: "one@example.com" },
      { email: "two@example.com" },
      { email: "three@example.com" },
    ],
    "POOL_1"
  );

  assert.deepEqual(result.result.created.map((entry: any) => entry.index), [0, 2]);
  assert.deepEqual(result.result.errors, [
    { index: 1, error: "duplicate contact" },
  ]);
});
