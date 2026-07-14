# Qualtrics MCP Server

An MCP server providing 110 tools: 108 Qualtrics actions across 14 API areas plus 2 server controls. It is a comprehensive survey-programming surface with a guarded JSON API v3 escape hatch; do not describe it as a dedicated wrapper for every licensed Qualtrics enterprise endpoint.

## Example Reference

See `examples/motivated-reasoning-study.ts` for a complete MCP-only example of building a complex multi-block experimental survey. It starts the server over stdio and performs every operation through registered MCP tools, without importing `QualtricsClient` or a REST service. Reference this file when structuring tool calls or designing tailored experiments.

**Key patterns demonstrated:**

- **Least-privilege writes** via `set_write_scopes` for only the survey-construction scopes required by the example
- **Survey creation** via `create_survey` and retrieving the returned default block
- **Block management**: creating multiple blocks, renaming the default block, and organizing by study phase
- **Question types**: MC/Likert, TE essay entry, and DB descriptive text for consent, treatments, and debriefing
- **DataExportTag**: always set on data-collecting questions (e.g., `DataExportTag: "PreBelief1"`) so exported columns have meaningful names
- **QuestionJS**: attaching JavaScript to DB questions through `add_descriptive_text_question` for client-side survey behavior
- **Embedded data flow**: declaring fields at the top of the flow, then setting values via piped text (`${q://QID.../ChoiceTextEntryValue}`) in downstream EmbeddedData elements
- **Piped text in QuestionText**: using `${e://Field/BeliefItem1}` to dynamically render embedded data as question text
- **BlockRandomizer**: `SubSet: 1, EvenPresentation: true` with Group elements inside for between-subjects experimental conditions
- **Pre/post measurement design**: identical belief items measured before and after treatment with different DataExportTags (`PreBelief1` vs `PostBelief1`)
- **Survey flow structure**: the full flow array with FlowID numbering, Block references, EmbeddedData nodes, and nested BlockRandomizer/Group elements
- **Safe completion**: patching survey options, validating the design, and creating an unpublished draft version without activating the survey

## Qualtrics API Conventions

- **DataExportTag**: Must be set on every question that collects data. Qualtrics auto-generates tags like `Q1`, `Q2` if omitted, making exported data hard to interpret.
- **QuestionJS escaping**: In TypeScript template literals, use `\${...}` (escaped dollar sign) for Qualtrics piped text that will appear in JavaScript strings. The `${` must not be interpreted by TypeScript.
- **Flow structure**: Every element needs a unique `FlowID` (e.g., `FL_100`, `FL_101`). The `Properties.Count` should equal the highest FlowID number used.
- **Block references in flow**: Use `{ Type: "Block", ID: blockId, Autofill: [] }`.
- **EmbeddedData in flow**: Declare fields with empty values at the top of the flow, then set values from piped text after the relevant questions are answered.

## Safety and Coverage

- The server starts read-only unless `QUALTRICS_READ_ONLY=false`. Prefer `set_write_scopes` and grant only the required scopes.
- Use dedicated tools when available. `qualtrics_api_request` is the guarded fallback for authorized JSON API v3 endpoints; known routes keep their normal scope, and otherwise-unmapped writes require `advanced`.
- Use dedicated import tools for multipart QSF/TXT/DOCX content and response tools for export downloads.
- Run `validate_survey_design` before versioning or activation. See `docs/API_COVERAGE.md` for the exact 110-tool inventory and limitations.

## Secrets

Never commit API keys or tokens. The following files contain secrets and are gitignored:

- `.env` — Qualtrics API token and data center config
- `.mcp.json` — MCP server configuration with embedded API token
