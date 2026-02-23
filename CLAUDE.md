# Qualtrics MCP Server

An MCP server providing 53 tools for full Qualtrics API coverage: surveys, questions, blocks, flow logic, response export, contacts, distributions, webhooks, and users.

## Example Reference

See `examples/motivated-reasoning-study.ts` for a complete, working example of building a complex multi-block experimental survey programmatically. Reference this file when structuring API calls or designing tailored experiments.

**Key patterns demonstrated:**

- **Survey creation** via `QualtricsClient.createSurvey()` and retrieving the default block
- **Block management**: creating 10+ blocks, renaming the default block, organizing by study phase
- **Question types**: MC (Likert scales, single-answer), TE (text entry with ESTB selector), DB (descriptive text for consent/debriefing, loading screens with HTML/CSS)
- **DataExportTag**: always set on data-collecting questions (e.g., `DataExportTag: "PreBelief1"`) so exported columns have meaningful names
- **QuestionJS**: attaching JavaScript to DB questions via GET+PUT (`getQuestion` then `updateQuestion` with `QuestionJS` field) for API calls from within the survey (item generation, dynamic argument display)
- **Embedded data flow**: declaring fields at the top of the flow, then setting values via piped text (`${q://QID.../ChoiceTextEntryValue}`) in downstream EmbeddedData elements
- **Piped text in QuestionText**: using `${e://Field/BeliefItem1}` to dynamically render embedded data as question text
- **BlockRandomizer**: `SubSet: 1, EvenPresentation: true` with Group elements inside for between-subjects experimental conditions
- **Pre/post measurement design**: identical belief items measured before and after treatment with different DataExportTags (`PreBelief1` vs `PostBelief1`)
- **Survey flow structure**: the full flow array with FlowID numbering, Block references, EmbeddedData nodes, and nested BlockRandomizer/Group elements

## Qualtrics API Conventions

- **DataExportTag**: Must be set on every question that collects data. Qualtrics auto-generates tags like `Q1`, `Q2` if omitted, making exported data hard to interpret.
- **QuestionJS escaping**: In TypeScript template literals, use `\${...}` (escaped dollar sign) for Qualtrics piped text that will appear in JavaScript strings. The `${` must not be interpreted by TypeScript.
- **Flow structure**: Every element needs a unique `FlowID` (e.g., `FL_100`, `FL_101`). The `Properties.Count` should equal the highest FlowID number used.
- **Block references in flow**: Use `{ Type: "Block", ID: blockId, Autofill: [] }`.
- **EmbeddedData in flow**: Declare fields with empty values at the top of the flow, then set values from piped text after the relevant questions are answered.

## Secrets

Never commit API keys or tokens. The following files contain secrets and are gitignored:
- `.env` — Qualtrics API token and data center config
- `.mcp.json` — MCP server configuration with embedded API token
