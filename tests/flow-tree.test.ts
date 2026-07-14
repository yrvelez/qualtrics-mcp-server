import assert from "node:assert/strict";
import test from "node:test";
import {
  allFlowIds,
  allocateFlowId,
  findFlowLocation,
  insertFlowElements,
  maxFlowNumber,
  normalizeFlowCount,
  removeFlowElement,
  walkFlow,
} from "../src/utils/flow-tree.js";

function nestedFlow(): Record<string, any> {
  return {
    Properties: { Count: 50 },
    Flow: [
      { Type: "Block", ID: "BL_root", FlowID: "FL_1" },
      {
        Type: "Branch",
        FlowID: "FL_7",
        Flow: [
          { Type: "EmbeddedData", FlowID: "FL_12" },
          {
            Type: "Group",
            FlowID: "legacy-id",
            Flow: [{ Type: "Block", ID: "BL_nested", FlowID: "FL_9" }],
          },
        ],
      },
    ],
  };
}

test("flow ID discovery, allocation, and normalization recurse through nested flow trees", () => {
  const flow = nestedFlow();
  const visited: string[] = [];

  walkFlow(flow.Flow, (element) => visited.push(element.FlowID));

  assert.deepEqual(visited, ["FL_1", "FL_7", "FL_12", "legacy-id", "FL_9"]);
  assert.deepEqual(allFlowIds(flow), visited);
  assert.equal(maxFlowNumber(flow), 12, "non-numeric legacy IDs must be ignored");
  assert.equal(
    allocateFlowId(flow),
    "FL_51",
    "allocation must honor a higher Qualtrics Properties.Count value"
  );

  assert.equal(normalizeFlowCount(flow), 12);
  assert.equal(flow.Properties.Count, 12);
  assert.equal(allocateFlowId(flow), "FL_13");
});

test("flow insertion supports exact root and nested placements", () => {
  const flow = nestedFlow();
  const branch = findFlowLocation(flow.Flow, "FL_7")?.element;
  assert.ok(branch);

  insertFlowElements(flow, [{ Type: "RootStart", FlowID: "FL_20" }], "beginning");
  insertFlowElements(flow, [{ Type: "RootEnd", FlowID: "FL_21" }], "end");
  insertFlowElements(
    flow,
    [{ Type: "BeforeNested", FlowID: "FL_22" }],
    "before",
    "FL_12"
  );
  insertFlowElements(
    flow,
    [{ Type: "AfterNested", FlowID: "FL_23" }],
    "after",
    "FL_12"
  );
  insertFlowElements(
    flow,
    [{ Type: "InsideStart", FlowID: "FL_24" }],
    "inside_beginning",
    "legacy-id"
  );
  insertFlowElements(
    flow,
    [{ Type: "InsideEnd", FlowID: "FL_25" }],
    "inside_end",
    "legacy-id"
  );

  assert.deepEqual(
    flow.Flow.map((element: Record<string, any>) => element.FlowID),
    ["FL_20", "FL_1", "FL_7", "FL_21"]
  );
  assert.deepEqual(
    branch.Flow.map((element: Record<string, any>) => element.FlowID),
    ["FL_22", "FL_12", "FL_23", "legacy-id"]
  );
  assert.deepEqual(
    branch.Flow[3].Flow.map((element: Record<string, any>) => element.FlowID),
    ["FL_24", "FL_9", "FL_25"]
  );
});

test("nested removal mutates only the owning array and returns the removed element", () => {
  const flow = nestedFlow();
  const branch = findFlowLocation(flow.Flow, "FL_7")?.element;
  assert.ok(branch);

  const removed = removeFlowElement(flow, "FL_12");

  assert.deepEqual(removed, { Type: "EmbeddedData", FlowID: "FL_12" });
  assert.deepEqual(
    branch.Flow.map((element: Record<string, any>) => element.FlowID),
    ["legacy-id"]
  );
  assert.deepEqual(
    flow.Flow.map((element: Record<string, any>) => element.FlowID),
    ["FL_1", "FL_7"]
  );
  assert.equal(removeFlowElement(flow, "FL_missing"), null);
});

test("invalid targeted placements fail before changing the flow", () => {
  const flow = nestedFlow();
  const before = structuredClone(flow);

  assert.throws(
    () => insertFlowElements(flow, [{ FlowID: "FL_20" }], "before"),
    /referenceFlowId is required/
  );
  assert.throws(
    () =>
      insertFlowElements(
        flow,
        [{ FlowID: "FL_20" }],
        "after",
        "FL_missing"
      ),
    /was not found/
  );
  assert.deepEqual(flow, before);

  const malformed = {
    Flow: [{ Type: "Branch", FlowID: "FL_1", Flow: { unexpected: true } }],
  };
  assert.throws(
    () =>
      insertFlowElements(
        malformed,
        [{ FlowID: "FL_2" }],
        "inside_end",
        "FL_1"
      ),
    /non-array Flow property/
  );
});
