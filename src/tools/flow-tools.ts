import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { FlowApi } from "../services/flow-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolError, toolSuccess, withErrorHandling, requireDeleteConfirmation } from "./_helpers.js";
import {
  allocateFlowId,
  allFlowIds,
  findFlowLocation,
  flowNodes,
  insertFlowElements,
  maxFlowNumber,
  normalizeFlowCount,
  removeFlowElement,
  walkFlow,
  type FlowPlacement,
} from "../utils/flow-tree.js";

const FLOW_PLACEMENT = z.enum([
  "beginning",
  "end",
  "before",
  "after",
  "inside_beginning",
  "inside_end",
]);

function flowTreeErrors(flow: Record<string, any>): string[] {
  const errors: string[] = [];
  if (!Array.isArray(flow.Flow)) {
    errors.push("The root Flow property must be an array.");
    return errors;
  }

  const seen = new Set<string>();
  for (const [index, element] of flowNodes(flow).entries()) {
    const label = index === 0
      ? "root flow"
      : `${element.Type ?? "unknown-type"} element #${index}`;
    if (typeof element.Type !== "string" || element.Type.length === 0) {
      errors.push(`${label} has no Type.`);
    }
    if (typeof element.FlowID !== "string" || element.FlowID.length === 0) {
      errors.push(`${label} has no FlowID.`);
    } else if (!/^FL_\d+$/.test(element.FlowID)) {
      errors.push(`${label} has malformed FlowID '${element.FlowID}'.`);
    } else if (seen.has(element.FlowID)) {
      errors.push(`Duplicate FlowID '${element.FlowID}'.`);
    } else {
      seen.add(element.FlowID);
    }
    if (element.Flow !== undefined && !Array.isArray(element.Flow)) {
      errors.push(`${label} has a non-array Flow property.`);
    }
  }
  return errors;
}

function assignInsertedFlowIds(
  flow: Record<string, any>,
  element: Record<string, any>
): string | null {
  const used = new Set(allFlowIds(flow));
  let nextNumber = Math.max(
    Number(flow.Properties?.Count) || 0,
    maxFlowNumber(flow)
  );
  let error: string | null = null;

  function prepare(node: unknown, label: string): void {
    if (error) return;
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      error = `${label} must be a flow-element object.`;
      return;
    }
    const definition = node as Record<string, any>;
    if (definition.FlowID === undefined) {
      do {
        nextNumber += 1;
        definition.FlowID = `FL_${nextNumber}`;
      } while (used.has(definition.FlowID));
    }
    if (typeof definition.FlowID !== "string" || !/^FL_\d+$/.test(definition.FlowID)) {
      error = `${label} FlowID must use the format FL_<number>.`;
      return;
    }
    if (used.has(definition.FlowID)) {
      error = `FlowID '${definition.FlowID}' already exists or is repeated in the inserted subtree.`;
      return;
    }
    used.add(definition.FlowID);
    if (typeof definition.Type !== "string" || definition.Type.length === 0) {
      error = `${label} must have a non-empty Type.`;
      return;
    }
    if (definition.Flow !== undefined) {
      if (!Array.isArray(definition.Flow)) {
        error = `${label} has a non-array Flow property.`;
        return;
      }
      definition.Flow.forEach((child: unknown, index: number) =>
        prepare(child, `${label}.Flow[${index}]`)
      );
    }
  }

  prepare(element, "element");
  return error;
}

export function registerFlowTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const flowApi = new FlowApi(client);

  // Get survey flow
  server.registerTool(
    "get_survey_flow",
    {
      description: "Get the full survey flow tree showing the order of blocks, embedded data, web services, branching, and randomization",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("get_survey_flow", async (args) => {
      const result = await flowApi.getFlow(args.surveyId);
      return toolSuccess({
        surveyId: args.surveyId,
        flow: result.result,
      });
    })
  );

  // Update survey flow (full replacement)
  server.registerTool(
    "update_survey_flow",
    {
      description: "Replace the entire survey flow tree. Use get_survey_flow first to get the current flow, modify it, then pass the full tree back.",
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        flow: z.any().describe("The complete flow tree object (same structure returned by get_survey_flow)"),
      },
    },
    withErrorHandling("update_survey_flow", async (args) => {
      const errors = flowTreeErrors(args.flow);
      if (errors.length > 0) {
        return toolError(`Invalid survey flow:\n${errors.join("\n")}`);
      }
      normalizeFlowCount(args.flow);
      const result = await flowApi.updateFlow(args.surveyId, args.flow);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        message: "Survey flow updated successfully",
        details: result.result,
      });
    })
  );

  // Insert a raw flow element without replacing the complete flow
  server.registerTool(
    "insert_flow_element",
    {
      description:
        "Insert any Qualtrics flow element (Block, Branch, Group, BlockRandomizer, EmbeddedData, WebService, EndSurvey, Authenticator, etc.) at an exact position. Allocates a collision-free FlowID when one is not supplied.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        element: z.record(z.any()).describe("Complete Qualtrics flow element definition; FlowID is optional"),
        placement: FLOW_PLACEMENT.optional().describe("Insertion position (default: end)"),
        referenceFlowId: z.string().optional().describe("Required for before, after, inside_beginning, and inside_end"),
      },
    },
    withErrorHandling("insert_flow_element", async (args) => {
      const current = await flowApi.getFlow(args.surveyId);
      const flow = current.result;
      const element = { ...args.element };
      const idError = assignInsertedFlowIds(flow, element);
      if (idError) return toolError(idError);

      insertFlowElements(
        flow,
        [element],
        (args.placement ?? "end") as FlowPlacement,
        args.referenceFlowId
      );
      normalizeFlowCount(flow);
      const result = await flowApi.updateFlow(args.surveyId, flow);

      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        flowId: element.FlowID,
        type: element.Type,
        placement: args.placement ?? "end",
        referenceFlowId: args.referenceFlowId,
        message: "Flow element inserted successfully",
        details: result.result,
      });
    })
  );

  // Safely patch a single flow element within the complete flow tree.
  server.registerTool(
    "update_flow_element",
    {
      description:
        "Update one flow element by FlowID. By default this fetches and carries forward the existing definition so omitted fields are preserved, then writes the normalized complete flow tree.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        flowId: z.string().min(1).describe("FlowID to update (for example, FL_12)"),
        element: z.record(z.any()).describe("Fields to update, or the complete replacement definition"),
        replace: z.boolean().optional().describe("Replace instead of merging with the current element (default: false)"),
      },
    },
    withErrorHandling("update_flow_element", async (args) => {
      const current = await flowApi.getFlow(args.surveyId);
      const location = findFlowLocation(current.result.Flow ?? [], args.flowId);
      if (!location) return toolError(`Flow element '${args.flowId}' was not found.`);

      const definition = args.replace
        ? { ...args.element, FlowID: args.flowId }
        : { ...location.element, ...args.element, FlowID: args.flowId };
      location.elements[location.index] = definition;
      const errors = flowTreeErrors(current.result);
      if (errors.length > 0) {
        return toolError(`Invalid updated survey flow:\n${errors.join("\n")}`);
      }
      normalizeFlowCount(current.result);
      const result = await flowApi.updateFlow(args.surveyId, current.result);

      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        flowId: args.flowId,
        message: "Flow element updated successfully",
        details: result.result,
      });
    })
  );

  // Move an existing flow element
  server.registerTool(
    "move_flow_element",
    {
      description:
        "Move an existing flow element anywhere in the top-level or nested flow while preserving its definition and FlowID.",
      annotations: { destructiveHint: false, idempotentHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        flowId: z.string().min(1).describe("FlowID to move"),
        placement: FLOW_PLACEMENT.describe("Destination position"),
        referenceFlowId: z.string().optional().describe("Required except for beginning/end"),
      },
    },
    withErrorHandling("move_flow_element", async (args) => {
      if (args.referenceFlowId === args.flowId) {
        return toolError("A flow element cannot be positioned relative to itself.");
      }

      const current = await flowApi.getFlow(args.surveyId);
      const flow = current.result;
      const location = findFlowLocation(flow.Flow ?? [], args.flowId);
      if (!location) return toolError(`Flow element '${args.flowId}' was not found.`);

      if (args.referenceFlowId && Array.isArray(location.element.Flow)) {
        const descendants: string[] = [];
        walkFlow(location.element.Flow, (element) => {
          if (typeof element.FlowID === "string") descendants.push(element.FlowID);
        });
        if (descendants.includes(args.referenceFlowId)) {
          return toolError("A flow element cannot be moved relative to one of its own descendants.");
        }
      }

      const element = removeFlowElement(flow, args.flowId)!;
      insertFlowElements(
        flow,
        [element],
        args.placement as FlowPlacement,
        args.referenceFlowId
      );
      normalizeFlowCount(flow);
      const result = await flowApi.updateFlow(args.surveyId, flow);

      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        flowId: args.flowId,
        placement: args.placement,
        referenceFlowId: args.referenceFlowId,
        message: "Flow element moved successfully",
        details: result.result,
      });
    })
  );

  // Delete one flow element
  server.registerTool(
    "delete_flow_element",
    {
      description: "Delete one top-level or nested flow element without rebuilding the rest of the flow",
      annotations: { destructiveHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        flowId: z.string().min(1).describe("FlowID to delete"),
        confirmDelete: z.boolean().describe("Must be true to confirm deletion"),
      },
    },
    withErrorHandling("delete_flow_element", async (args) => {
      const guard = requireDeleteConfirmation(args);
      if (guard) return guard;

      const current = await flowApi.getFlow(args.surveyId);
      const flow = current.result;
      const removed = removeFlowElement(flow, args.flowId);
      if (!removed) return toolError(`Flow element '${args.flowId}' was not found.`);

      normalizeFlowCount(flow);
      const result = await flowApi.updateFlow(args.surveyId, flow);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        flowId: args.flowId,
        removedType: removed.Type,
        message: "Flow element deleted successfully",
        details: result.result,
      });
    })
  );

  // Validate cross-references and identifiers before publishing
  server.registerTool(
    "validate_survey_design",
    {
      description:
        "Read-only preflight for a programmed survey. Checks FlowID uniqueness/counts, flow block references, block question references, DataExportTag presence/uniqueness, and unreachable blocks before activation or publishing.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("validate_survey_design", async (args) => {
      const [definitionResult, flowResult] = await Promise.all([
        client.getSurveyDefinition(args.surveyId),
        flowApi.getFlow(args.surveyId),
      ]);
      const definition = definitionResult.result;
      const flow = flowResult.result;
      const questions: Record<string, any> = definition.Questions ?? definition.questions ?? {};
      const blocks: Record<string, any> = definition.Blocks ?? definition.blocks ?? {};
      const errors: string[] = [];
      const warnings: string[] = [];

      errors.push(...flowTreeErrors(flow));
      const flowIds = allFlowIds(flow);
      const actualMax = maxFlowNumber(flow);
      if (Number(flow.Properties?.Count) !== actualMax) {
        errors.push(`Flow Properties.Count is ${String(flow.Properties?.Count)}, but the highest FlowID is ${actualMax}.`);
      }

      const blockIds = new Set(Object.keys(blocks));
      const questionIds = new Set(Object.keys(questions));
      const referencedBlocks = new Set<string>();
      walkFlow(Array.isArray(flow.Flow) ? flow.Flow : [], (element) => {
        if (element.Type === "Block" && typeof element.ID === "string") {
          referencedBlocks.add(element.ID);
          if (!blockIds.has(element.ID)) errors.push(`Flow ${element.FlowID} references missing block ${element.ID}.`);
        }
      });

      function inspectBlockValue(value: unknown, blockId: string): void {
        if (Array.isArray(value)) {
          for (const item of value) inspectBlockValue(item, blockId);
        } else if (value && typeof value === "object") {
          const element = value as Record<string, any>;
          if (element.Type === "Question" && typeof element.QuestionID === "string" && !questionIds.has(element.QuestionID)) {
            errors.push(`Block ${blockId} references missing question ${element.QuestionID}.`);
          }
          for (const nested of Object.values(element)) inspectBlockValue(nested, blockId);
        }
      }
      for (const [blockId, block] of Object.entries(blocks)) {
        inspectBlockValue(block.BlockElements ?? [], blockId);
        if (block.Type !== "Trash" && !referencedBlocks.has(blockId)) {
          warnings.push(`Block ${blockId} (${block.Description ?? "unnamed"}) is not reachable from the survey flow.`);
        }
      }

      const tags = new Map<string, string[]>();
      for (const [mapId, question] of Object.entries(questions)) {
        const questionId = question.QuestionID ?? mapId;
        const tag = question.DataExportTag;
        if (question.QuestionType !== "DB" && (!tag || typeof tag !== "string")) {
          warnings.push(`Question ${questionId} has no DataExportTag.`);
        }
        if (typeof tag === "string" && tag.length > 0) {
          const ids = tags.get(tag) ?? [];
          ids.push(questionId);
          tags.set(tag, ids);
        }
      }
      for (const [tag, ids] of tags) {
        if (ids.length > 1) errors.push(`DataExportTag '${tag}' is used by multiple questions: ${ids.join(", ")}.`);
      }

      return toolSuccess({
        surveyId: args.surveyId,
        valid: errors.length === 0,
        errors,
        warnings,
        summary: {
          questions: questionIds.size,
          blocks: blockIds.size,
          flowElements: flowIds.length,
          highestFlowId: actualMax,
          uniqueDataExportTags: tags.size,
        },
      });
    })
  );

  // Add embedded data fields
  server.registerTool(
    "add_embedded_data",
    {
      description: "Add embedded data fields anywhere in the survey flow. Place declarations at the beginning, or place assignments after the question/web service that produces their values. Fields are referenced with ${e://Field/FieldName}.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        fields: z.array(z.object({
          name: z.string().describe("Field name (used in piped text as ${e://Field/name})"),
          value: z.string().optional().describe("Default value (can include piped text). Leave empty to set via URL param or contact list."),
          type: z.enum(["Custom", "Recipient"]).optional().describe("'Custom' for flow-set fields, 'Recipient' for contact list fields (default: Custom)"),
          variableType: z.enum(["String", "Number", "DateTime", "Boolean"]).optional().describe("Embedded-data variable type (default: String)"),
          analyzeText: z.boolean().optional().describe("Enable text analysis for this field (default: false)"),
        })).min(1).describe("Array of embedded data fields to add"),
        placement: FLOW_PLACEMENT.optional().describe("Insertion position (default: beginning)"),
        referenceFlowId: z.string().optional().describe("Required for before, after, inside_beginning, and inside_end"),
      },
    },
    withErrorHandling("add_embedded_data", async (args) => {
      // GET current flow
      const currentFlow = await flowApi.getFlow(args.surveyId);
      const flow = currentFlow.result;

      // Build embedded data element
      const edElement: Record<string, any> = {
        FlowID: allocateFlowId(flow),
        Type: "EmbeddedData",
        EmbeddedData: args.fields.map((f: any) => ({
          Description: f.name,
          Type: f.type || "Custom",
          Field: f.name,
          VariableType: f.variableType || "String",
          DataVisibility: [],
          AnalyzeText: f.analyzeText ?? false,
          Value: f.value || "",
        })),
      };

      insertFlowElements(
        flow,
        [edElement],
        (args.placement ?? "beginning") as FlowPlacement,
        args.referenceFlowId
      );
      normalizeFlowCount(flow);

      // PUT updated flow
      const result = await flowApi.updateFlow(args.surveyId, flow);

      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        flowId: edElement.FlowID,
        fields: args.fields.map((f: any) => ({
          name: f.name,
          pipedText: `\${e://Field/${f.name}}`,
          defaultValue: f.value || "(set via URL param or contact list)",
        })),
        placement: args.placement ?? "beginning",
        referenceFlowId: args.referenceFlowId,
        message: `${args.fields.length} embedded data field(s) added to survey flow`,
        tip: "Pass values via survey URL: ?FieldName=value or set them in a contact list / mailing list",
      });
    })
  );

  // Add web service element
  server.registerTool(
    "add_web_service",
    {
      description: "Add a Web Service element anywhere in the survey flow. Response values can be mapped to embedded data fields for downstream piped text. For authentication, headers, or advanced Qualtrics fields, use additionalFields.",
      annotations: { destructiveHint: false },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
        url: z.string().min(1).describe("Target URL for the HTTP call (can include piped text like ${e://Field/ResponseID})"),
        method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().describe("HTTP method (default: GET)"),
        requestParams: z.array(z.object({
          key: z.string().describe("Parameter name"),
          value: z.string().describe("Parameter value (can use piped text)"),
        })).optional().describe("Request parameters sent as the body (for POST/PUT) or query string (for GET)"),
        responseMapping: z.array(z.object({
          jsonPath: z.string().describe("Dot-notation path in the JSON response (e.g., 'data.score', 'result.name')"),
          fieldName: z.string().describe("Embedded data field name to store the value in"),
        })).min(1).describe("Map response JSON paths to embedded data fields"),
        placement: FLOW_PLACEMENT.optional().describe("Insertion position (default: beginning)"),
        referenceFlowId: z.string().optional().describe("Required for before, after, inside_beginning, and inside_end"),
        declareResponseFields: z.boolean().optional().describe("Also insert an EmbeddedData declaration for mapped fields (default: true)"),
        additionalFields: z.record(z.any()).optional().describe("Other WebService definition fields, such as headers or authentication; merged last"),
      },
    },
    withErrorHandling("add_web_service", async (args) => {
      // GET current flow
      const currentFlow = await flowApi.getFlow(args.surveyId);
      const flow = currentFlow.result;

      const firstFlowId = allocateFlowId(flow);
      const firstFlowNumber = Number(firstFlowId.slice(3));

      // Build the embedded data declarations for response-mapped fields
      const edFields = args.responseMapping.map((m: any) => ({
        Description: m.fieldName,
        Type: "Custom",
        Field: m.fieldName,
        VariableType: "String",
        DataVisibility: [],
        AnalyzeText: false,
        Value: "",
      }));

      // Build web service element (Qualtrics uses arrays with lowercase key/value)
      const wsElement: Record<string, any> = {
        FlowID: `FL_${firstFlowNumber + 1}`,
        Type: "WebService",
        URL: args.url,
        Method: args.method || "GET",
        RequestParams: (args.requestParams || []).map((p: any) => ({
          key: p.key,
          value: p.value,
        })),
        ResponseMap: args.responseMapping.map((m: any) => ({
          key: m.jsonPath,
          value: m.fieldName,
        })),
      };
      if (args.additionalFields) Object.assign(wsElement, args.additionalFields);
      wsElement.FlowID = `FL_${firstFlowNumber + 1}`;
      wsElement.Type = "WebService";

      // Also add an embedded data element to declare the target fields
      const edElement: Record<string, any> = {
        FlowID: firstFlowId,
        Type: "EmbeddedData",
        EmbeddedData: edFields,
      };

      const elements = args.declareResponseFields === false ? [wsElement] : [edElement, wsElement];
      insertFlowElements(
        flow,
        elements,
        (args.placement ?? "beginning") as FlowPlacement,
        args.referenceFlowId
      );
      normalizeFlowCount(flow);

      // PUT updated flow
      const result = await flowApi.updateFlow(args.surveyId, flow);

      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        webServiceFlowId: wsElement.FlowID,
        embeddedDataFlowId: args.declareResponseFields === false ? null : edElement.FlowID,
        url: args.url,
        method: args.method || "GET",
        mappedFields: args.responseMapping.map((m: any) => ({
          from: m.jsonPath,
          to: m.fieldName,
          pipedText: `\${e://Field/${m.fieldName}}`,
        })),
        placement: args.placement ?? "beginning",
        referenceFlowId: args.referenceFlowId,
        message: "Web service element added to survey flow",
        tip: "Use the mapped fields in question text with piped text, e.g., ${e://Field/FieldName}",
      });
    })
  );

  // Piped text reference
  server.registerTool(
    "piped_text_reference",
    {
      description: "Look up Qualtrics piped text syntax. Returns the correct syntax for referencing question responses, embedded data, contact fields, and more in question text, default values, or web service configurations. Use this when you need to dynamically insert values into survey questions.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        category: z.enum([
          "question_response",
          "embedded_data",
          "contact_fields",
          "date_time",
          "random",
          "loop_merge",
          "scoring",
          "all",
        ]).optional().describe("Category of piped text to look up (default: all)"),
        surveyId: z.string().optional().describe("If provided, also lists available question IDs and embedded data fields from this survey"),
      },
    },
    async (args) => {
      const reference: Record<string, any> = {
        question_response: {
          title: "Question Responses",
          syntax: [
            { pattern: "${q://QID#/ChoiceGroup/SelectedChoices}", description: "Selected choice display text (single or comma-separated)", example: "${q://QID1/ChoiceGroup/SelectedChoices}" },
            { pattern: "${q://QID#/SelectedChoicesRecode}", description: "Selected choice recode/numeric value", example: "${q://QID1/SelectedChoicesRecode}" },
            { pattern: "${q://QID#/ChoiceTextEntryValue}", description: "Text entry value from a choice", example: "${q://QID2/ChoiceTextEntryValue}" },
            { pattern: "${q://QID#/ChoiceGroup/SelectedChoicesTextEntry}", description: "Selected choices including any 'Other' text", example: "${q://QID1/ChoiceGroup/SelectedChoicesTextEntry}" },
            { pattern: "${q://QID#/SelectedChoicesCount}", description: "Number of choices selected", example: "${q://QID3/SelectedChoicesCount}" },
            { pattern: "${q://QID#/ChoiceGroup/UnselectedChoices}", description: "Choices NOT selected", example: "${q://QID1/ChoiceGroup/UnselectedChoices}" },
            { pattern: "${q://QID#/QuestionText}", description: "The question text itself", example: "${q://QID1/QuestionText}" },
          ],
          notes: "A page break must exist between the source question and the question using piped text.",
        },
        embedded_data: {
          title: "Embedded Data Fields",
          syntax: [
            { pattern: "${e://Field/FieldName}", description: "Value of an embedded data field", example: "${e://Field/UserScore}" },
            { pattern: "${e://Field/ResponseID}", description: "Current response ID", example: "${e://Field/ResponseID}" },
            { pattern: "${e://Field/SurveyID}", description: "Current survey ID", example: "${e://Field/SurveyID}" },
          ],
          notes: "Fields must be declared in the survey flow (via add_embedded_data) before they can be referenced. Set values via URL parameters (?FieldName=value), contact lists, or web services.",
        },
        contact_fields: {
          title: "Contact / Panel Fields",
          syntax: [
            { pattern: "${m://FirstName}", description: "Contact first name", example: "${m://FirstName}" },
            { pattern: "${m://LastName}", description: "Contact last name", example: "${m://LastName}" },
            { pattern: "${m://Email}", description: "Contact email", example: "${m://Email}" },
            { pattern: "${m://ExternalDataReference}", description: "External reference ID", example: "${m://ExternalDataReference}" },
            { pattern: "${m://Language}", description: "Contact language", example: "${m://Language}" },
          ],
          notes: "Only available when the survey is distributed via a contact list / mailing list.",
        },
        date_time: {
          title: "Date & Time",
          syntax: [
            { pattern: "${date://CurrentDate/format}", description: "Current date in specified format", example: "${date://CurrentDate/m%2Fd%2FY}" },
          ],
          notes: "Format uses URL-encoded date codes. Common: m%2Fd%2FY = M/D/YYYY, Y-m-d = YYYY-MM-DD",
        },
        random: {
          title: "Random Numbers",
          syntax: [
            { pattern: "${rand://int/min:max}", description: "Random integer in range", example: "${rand://int/1:100}" },
          ],
        },
        loop_merge: {
          title: "Loop & Merge",
          syntax: [
            { pattern: "${lm://Field/N}", description: "Loop & merge field value (N = column number)", example: "${lm://Field/1}" },
            { pattern: "${lm://CurrentLoopNumber}", description: "Current loop iteration number", example: "${lm://CurrentLoopNumber}" },
          ],
        },
        scoring: {
          title: "Scoring",
          syntax: [
            { pattern: "${gr://SC_ID/Score}", description: "Scoring category total", example: "${gr://SC_abc123/Score}" },
            { pattern: "${gr://SC_ID/WeightedMean}", description: "Weighted mean score", example: "${gr://SC_abc123/WeightedMean}" },
          ],
        },
      };

      const category = args.category || "all";
      let output: any;

      if (category === "all") {
        output = { reference };
      } else {
        output = { reference: { [category]: reference[category] } };
      }

      // If surveyId provided, also list available questions and embedded data
      if (args.surveyId) {
        try {
          const [defResult, flowResult] = await Promise.all([
            client.getSurveyDefinition(args.surveyId),
            new FlowApi(client).getFlow(args.surveyId),
          ]);

          const questions = defResult.result.Questions || {};
          output.surveyQuestions = Object.entries(questions).map(([qid, q]: [string, any]) => ({
            questionId: qid,
            text: q.QuestionText?.substring(0, 80),
            type: q.QuestionType,
            pipedText: `\${q://${qid}/ChoiceGroup/SelectedChoices}`,
          }));

          // Extract embedded data fields from flow
          const edFields: string[] = [];
          function extractED(flowElements: any[]) {
            for (const el of flowElements) {
              if (el.Type === "EmbeddedData" && el.EmbeddedData) {
                for (const field of el.EmbeddedData) {
                  edFields.push(field.Field);
                }
              }
              if (el.Flow) extractED(el.Flow);
            }
          }
          extractED(flowResult.result.Flow || []);

          output.embeddedDataFields = edFields.map(f => ({
            field: f,
            pipedText: `\${e://Field/${f}}`,
          }));
        } catch {
          output.surveyLookupError = "Could not fetch survey details for piped text suggestions.";
        }
      }

      return toolSuccess(output);
    }
  );

  // List embedded data fields
  server.registerTool(
    "list_embedded_data",
    {
      description: "List all embedded data fields currently defined in a survey's flow",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("list_embedded_data", async (args) => {
      const flowResult = await flowApi.getFlow(args.surveyId);

      const fields: Array<{ field: string; value: string; type: string; flowId: string }> = [];
      function extractED(flowElements: any[]) {
        for (const el of flowElements) {
          if (el.Type === "EmbeddedData" && el.EmbeddedData) {
            for (const f of el.EmbeddedData) {
              fields.push({
                field: f.Field,
                value: f.Value || "",
                type: f.Type || "Custom",
                flowId: el.FlowID,
              });
            }
          }
          if (el.Flow) extractED(el.Flow);
        }
      }
      extractED(flowResult.result.Flow || []);

      return toolSuccess({
        surveyId: args.surveyId,
        embeddedDataFields: fields.map(f => ({
          ...f,
          pipedText: `\${e://Field/${f.field}}`,
        })),
        total: fields.length,
      });
    })
  );

  // List web services in flow
  server.registerTool(
    "list_web_services",
    {
      description: "List all Web Service elements currently defined in a survey's flow",
      annotations: { readOnlyHint: true },
      inputSchema: {
        surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      },
    },
    withErrorHandling("list_web_services", async (args) => {
      const flowResult = await flowApi.getFlow(args.surveyId);

      const services: any[] = [];
      function extractWS(flowElements: any[]) {
        for (const el of flowElements) {
          if (el.Type === "WebService") {
            services.push({
              flowId: el.FlowID,
              url: el.URL,
              method: el.Method,
              responseMapping: el.ResponseMap?.map((m: any) => ({
                from: m.Key ?? m.key,
                to: m.Value ?? m.value,
              })) || [],
            });
          }
          if (el.Flow) extractWS(el.Flow);
        }
      }
      extractWS(flowResult.result.Flow || []);

      return toolSuccess({
        surveyId: args.surveyId,
        webServices: services,
        total: services.length,
      });
    })
  );
}
