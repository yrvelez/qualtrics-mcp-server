import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QualtricsClient } from "../services/qualtrics-client.js";
import { FlowApi } from "../services/flow-api.js";
import { QualtricsConfig } from "../config/settings.js";
import { toolError, toolSuccess, withErrorHandling } from "./_helpers.js";

export function registerFlowTools(
  server: McpServer,
  client: QualtricsClient,
  config: QualtricsConfig
) {
  const flowApi = new FlowApi(client);

  // Get survey flow
  server.tool(
    "get_survey_flow",
    "Get the full survey flow tree showing the order of blocks, embedded data, web services, branching, and randomization",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
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
  server.tool(
    "update_survey_flow",
    "Replace the entire survey flow tree. Use get_survey_flow first to get the current flow, modify it, then pass the full tree back.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      flow: z.any().describe("The complete flow tree object (same structure returned by get_survey_flow)"),
    },
    withErrorHandling("update_survey_flow", async (args) => {
      const result = await flowApi.updateFlow(args.surveyId, args.flow);
      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        message: "Survey flow updated successfully",
        details: result.result,
      });
    })
  );

  // Add embedded data fields
  server.tool(
    "add_embedded_data",
    "Add embedded data fields to the survey flow. These fields can be set via URL parameters, contact lists, or web services, and referenced in questions with piped text ${e://Field/FieldName}. The embedded data element is inserted at the beginning of the flow (before all blocks) so fields are available throughout.",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
      fields: z.array(z.object({
        name: z.string().describe("Field name (used in piped text as ${e://Field/name})"),
        value: z.string().optional().describe("Default value (can include piped text). Leave empty to set via URL param or contact list."),
        type: z.enum(["Custom", "Recipient"]).optional().describe("'Custom' for flow-set fields, 'Recipient' for contact list fields (default: Custom)"),
      })).min(1).describe("Array of embedded data fields to add"),
    },
    withErrorHandling("add_embedded_data", async (args) => {
      // GET current flow
      const currentFlow = await flowApi.getFlow(args.surveyId);
      const flow = currentFlow.result;

      // Determine next FlowID
      const nextFlowNum = (flow.Properties?.Count || flow.Flow.length) + 1;

      // Build embedded data element
      const edElement: Record<string, any> = {
        FlowID: `FL_${nextFlowNum}`,
        Type: "EmbeddedData",
        EmbeddedData: args.fields.map((f: any) => ({
          Description: f.name,
          Type: f.type || "Custom",
          Field: f.name,
          VariableType: "String",
          DataVisibility: [],
          AnalyzeText: false,
          Value: f.value || "",
        })),
      };

      // Insert at the beginning of the flow (before blocks)
      flow.Flow.unshift(edElement);
      flow.Properties.Count = nextFlowNum;

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
        message: `${args.fields.length} embedded data field(s) added to survey flow`,
        tip: "Pass values via survey URL: ?FieldName=value or set them in a contact list / mailing list",
      });
    })
  );

  // Add web service element
  server.tool(
    "add_web_service",
    "Add a Web Service element to the survey flow that makes an HTTP call to an external API during survey execution. Response values can be mapped to embedded data fields for use in subsequent questions via piped text. The web service is inserted at the position you specify (default: before the first block).",
    {
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
      position: z.enum(["beginning", "end"]).optional().describe("Where to insert in the flow (default: beginning)"),
    },
    withErrorHandling("add_web_service", async (args) => {
      // GET current flow
      const currentFlow = await flowApi.getFlow(args.surveyId);
      const flow = currentFlow.result;

      const currentCount = flow.Properties?.Count || flow.Flow.length;

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
        FlowID: `FL_${currentCount + 1}`,
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

      // Also add an embedded data element to declare the target fields
      const edElement: Record<string, any> = {
        FlowID: `FL_${currentCount + 2}`,
        Type: "EmbeddedData",
        EmbeddedData: edFields,
      };

      if (args.position === "end") {
        flow.Flow.push(edElement, wsElement);
      } else {
        // Insert at beginning: ED first, then WS, then existing flow
        flow.Flow.unshift(edElement, wsElement);
      }
      flow.Properties.Count = currentCount + 2;

      // PUT updated flow
      const result = await flowApi.updateFlow(args.surveyId, flow);

      return toolSuccess({
        success: true,
        surveyId: args.surveyId,
        webServiceFlowId: wsElement.FlowID,
        embeddedDataFlowId: edElement.FlowID,
        url: args.url,
        method: args.method || "GET",
        mappedFields: args.responseMapping.map((m: any) => ({
          from: m.jsonPath,
          to: m.fieldName,
          pipedText: `\${e://Field/${m.fieldName}}`,
        })),
        message: "Web service element added to survey flow",
        tip: "Use the mapped fields in question text with piped text, e.g., ${e://Field/FieldName}",
      });
    })
  );

  // Piped text reference
  server.tool(
    "piped_text_reference",
    "Look up Qualtrics piped text syntax. Returns the correct syntax for referencing question responses, embedded data, contact fields, and more in question text, default values, or web service configurations. Use this when you need to dynamically insert values into survey questions.",
    {
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
  server.tool(
    "list_embedded_data",
    "List all embedded data fields currently defined in a survey's flow",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
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
  server.tool(
    "list_web_services",
    "List all Web Service elements currently defined in a survey's flow",
    {
      surveyId: z.string().min(1).describe("The Qualtrics survey ID"),
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
                from: m.Key,
                to: m.Value,
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
