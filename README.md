# Qualtrics MCP Server

An MCP server for end-to-end Qualtrics questionnaire programming and operations. Its 110 tools let any MCP client build complex surveys, edit nested flow logic, manage options, quotas, translations, versions, contacts, distributions, libraries, webhooks, and responses without importing this repository's TypeScript services.

The server has 108 Qualtrics action tools across 14 API areas, plus 2 server-permission controls. It provides a comprehensive survey-programming surface and a guarded JSON API v3 escape hatch; it does not claim that every licensed Qualtrics enterprise product has a dedicated wrapper.

## Tool coverage

| Area | Count | What is covered |
|---|---:|---|
| Surveys | 8 | List, get, create, update, delete, activate, deactivate, estimate export size |
| Survey design | 11 | Metadata, safely merged options, versions, enabled languages, translations |
| Questions | 13 | Raw CRUD, MC, text entry, descriptive text, Likert, Matrix, rank order, constant sum, reusable templates |
| Blocks | 5 | List, get, create, safely update full definitions, delete |
| Survey flow | 12 | Full-tree get/replace, insert/update/move/delete nested elements, validation, embedded data, web services, piped text |
| Quotas | 10 | CRUD for quotas and quota groups |
| Responses | 8 | Streamed full/filtered export, export status/download, individual response create/get/delete, queued embedded-data update |
| Contacts | 11 | Current XM Directory mailing-list and contact CRUD, cursor pagination, bounded sequential bulk import |
| Distributions | 8 | Distribution listing/details/links, anonymous links, invitations, reminders, thank-yous, deletion |
| Libraries | 11 | Libraries, reusable survey assets and multilingual messages, graphic upload/delete |
| Survey import and copy | 5 | Survey copy plus QSF, TXT, URL, and base64 DOCX imports |
| Webhooks | 3 | Event-subscription list, create, delete |
| Users | 2 | List users and get user details |
| Advanced API | 1 | Guarded JSON requests to other Qualtrics API v3 endpoints |
| Server control | 2 | Least-privilege write scopes and read-only toggle |
| **Total** | **110** | **108 Qualtrics actions + 2 server controls** |

See [docs/API_COVERAGE.md](docs/API_COVERAGE.md) for the exact tool inventory, scope mapping, and boundaries.

## Complex questionnaires through MCP only

The tool set supports the full construction loop:

1. Create or copy a draft survey and retrieve its default block.
2. Create blocks and common question types with meaningful `DataExportTag` values, recodes, validation, HTML, and optional `QuestionJS`.
3. Use raw question payloads or clone `get_question_template` output for specialized Qualtrics question types.
4. Build nested branches, groups, randomizers, embedded-data declarations and assignments, block references, and web-service calls. Incremental flow tools allocate collision-free `FlowID` values and normalize `Properties.Count`.
5. Safely patch survey options, configure quotas and translations, then run `validate_survey_design` before creating a version or activating the survey.

The reference implementation at [examples/motivated-reasoning-study.ts](examples/motivated-reasoning-study.ts) uses an MCP client over stdio for every operation. It creates a multi-block randomized experiment with explicit export tags, embedded data, piped text, pre/post measures, options, validation, and a draft version. It intentionally does not activate the survey.

From a repository checkout, run it only when you want to create that draft in the configured Qualtrics account. The script builds and launches the packaged server entrypoint before making MCP calls:

```bash
pnpm example:motivated-reasoning
```

## Notable tools

### Survey structure and logic

- `create_question` and `update_question` expose full question-definition fields while preserving existing fields during partial updates.
- `add_multiple_choice_question`, `add_text_entry_question`, `add_descriptive_text_question`, `add_likert_question`, `add_matrix_question`, `add_rank_order_question`, and `add_constant_sum_question` provide validated common paths.
- `get_question_template` returns a sanitized definition for cloning specialized types such as side-by-side, sliders, or heatmaps.
- `insert_flow_element`, `update_flow_element`, `move_flow_element`, and `delete_flow_element` edit both top-level and nested flow nodes without rebuilding unrelated branches.
- `add_embedded_data` and `add_web_service` support exact placement within the flow; `piped_text_reference` returns the corresponding Qualtrics syntax.
- `validate_survey_design` checks duplicate or missing `FlowID` values, `Properties.Count`, block and question references, unreachable blocks, and missing or duplicate export tags.

### Survey settings and reusable designs

- `update_survey_options` recursively merges patches with current options by default so omitted nested settings survive. Set `replace=true` only for an intentional full replacement.
- Survey versions, enabled languages, and translations have dedicated read/write tools; language-map and translation updates safely merge by default.
- Quotas and quota groups have complete dedicated CRUD tools.
- Library tools list reusable survey blocks, questions, and surveys; manage multilingual messages; and upload or delete JPEG, GIF, and PNG graphics.
- `copy_survey` preserves complex question types, scoring, styling, flow, and other settings that do not have individual public mutation endpoints.
- `import_survey_qsf`, `import_survey_text`, and `import_survey_docx` use the official multipart import path; `import_survey_from_url` lets Qualtrics fetch a public HTTPS QSF, TXT, or DOCX file.

### Contacts and response data

- All contact tools use the current XM Directory API and require a licensed directory ID (`directoryId`, usually `POOL_...`). Discover directories with `qualtrics_api_request` using `GET /directories` if you do not already know the ID.
- Mailing-list pages accept up to 100 results and contact pages up to 50. Continue with the returned `nextSkipToken`; `includeCount` is approximate and can be slower on large lists.
- `remove_contact` removes membership from the selected mailing list only; it does not delete the person from the directory. Qualtrics does not support `get_mailing_list` or `delete_mailing_list` on shared mailing lists.
- Contact identity rules vary by directory configuration; create tools accept email, first/last name, or `externalDataReference` and let Qualtrics apply the brand's exact matching requirements.
- `bulk_import_contacts` is a bounded, sequential, non-atomic helper and reports per-input failures. It does not hide partial success.
- Response downloads buffer only small results; large bodies stream to a collision-safe file in Downloads. A slow healthy transfer can exceed `REQUEST_TIMEOUT` overall because the download timeout is applied to headers and each inactive read, not total duration.

### Advanced JSON API access

Use `qualtrics_api_request` when an authorized Qualtrics API v3 JSON endpoint lacks a dedicated tool. The request remains pinned to the configured Qualtrics origin:

- `GET` works in read-only mode.
- `POST`, `PUT`, and `PATCH` accept a JSON body.
- `DELETE` requires `confirmDelete: true`.
- Known routes still require their normal least-privilege scope; only otherwise-unmapped writes use the high-risk `advanced` scope.
- The path cannot contain another origin, query text, fragments, backslashes, traversal, whitespace, duplicate/trailing slashes, or percent-encoded segments. Query parameters are encoded separately.

Prefer dedicated tools where available because they validate payloads, preserve full-replacement resources, and add safety checks. The escape hatch is intentionally JSON-focused; use the dedicated survey-import tools for multipart uploads and response-export tools for downloads.

## Safety and write scopes

The safe default is read-only. Unless `QUALTRICS_READ_ONLY=false` is set, no write scope is enabled at startup. Most read operations, including starting a response export, remain available. `list_distribution_links` is the exception: Qualtrics documents side effects for that `GET`, so the server requires the `distributions` scope.

Use `set_write_scopes` to enable only the categories required for a task:

| Scope | Risk | Examples |
|---|---|---|
| `questionsAndBlocks` | Low | Questions and blocks |
| `distributions` | Minimal | Links, invitations, reminders, thank-yous |
| `surveyDesign` | Medium | Flow, options, versions, quotas, languages, translations, webhooks |
| `libraries` | Medium | Reusable survey assets, messages, and graphics |
| `surveys` | High | Survey creation/import/copy, metadata, activation, deletion |
| `contacts` | High | Mailing lists and contacts |
| `users` | High | User-account changes |
| `advanced` | High | Otherwise-unmapped API writes; impact depends on the endpoint |

`set_read_only_mode` remains as a convenience switch. Setting it to `false` enables every scope; scoped permission grants are safer for normal use. Delete tools also require explicit confirmation where appropriate.

## Setup

### Requirements

- Node.js 22 or later
- A Qualtrics API token with the permissions required by the endpoints you use
- Your Qualtrics data-center ID

```bash
pnpm install
cp .env.example .env
# Fill in the two required Qualtrics values, then:
pnpm start
```

### Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `QUALTRICS_API_TOKEN` | Yes | - | Qualtrics API token |
| `QUALTRICS_DATA_CENTER` | Yes | - | Data-center ID such as `yul1` or `iad1` |
| `QUALTRICS_BASE_URL` | No | `https://<data-center>.qualtrics.com/API/v3` | API v3 base URL override |
| `QUALTRICS_READ_ONLY` | No | `true` | Use `false` to enable all write scopes at startup |
| `RATE_LIMITING_ENABLED` | No | `true` | Enable the client-side request limiter |
| `RATE_LIMIT_RPM` | No | `50` | Requests per minute |
| `REQUEST_TIMEOUT` | No | `30000` | Ordinary request timeout and response-download header/chunk inactivity timeout, in milliseconds |

Missing token or data-center configuration fails at startup with setup guidance. Never commit tokens; `.env` and `.mcp.json` are gitignored because they may contain secrets.

### MCP client configuration

Build once, then point any stdio-capable MCP client at the compiled entrypoint:

```bash
pnpm build
```

```json
{
  "mcpServers": {
    "qualtrics": {
      "command": "node",
      "args": ["/absolute/path/to/qualtrics_mcp/build/index.js"],
      "env": {
        "QUALTRICS_API_TOKEN": "your_api_token",
        "QUALTRICS_DATA_CENTER": "your_data_center_id"
      }
    }
  }
}
```

## Qualtrics design conventions

- Set an explicit, stable `DataExportTag` on every data-collecting question. The creation tools derive a readable fallback when omitted, but explicit study-specific names keep exports and pre/post measures unambiguous.
- For Matrix questions, `Choices` are rows/statements and `Answers` are columns/scale points. `add_matrix_question` supplies the Qualtrics boilerplate and validates selector/sub-selector pairs.
- In TypeScript template literals, escape the dollar sign in Qualtrics piped text as `\${...}` when it must remain literal at runtime.
- Every raw flow element needs a unique `FlowID`; `Properties.Count` must equal the highest numeric ID. The incremental flow tools manage both automatically.
- Declare embedded-data fields near the beginning of the flow, then assign their values after the question or web service that produces them.
- In the New Survey Taking Experience (formerly Simple Layout), use drag-and-drop (`DND`) for Rank Order and Choices/text entry (`VRTL`) for Constant Sum. Rank Order select/text boxes and Constant Sum bar/slider variants require the legacy experience.

## Development

```bash
pnpm start                 # Run from TypeScript using .env
pnpm dev                   # Watch mode
pnpm typecheck             # Type-check server code
pnpm typecheck:examples    # Type-check the MCP-only reference example
pnpm test                  # Run the Node test suite
pnpm build                 # Compile the distributable server
```

The MCP protocol uses stdout, so diagnostics must go to stderr. The implementation's rate-limit and mode messages follow that rule.

## Coverage boundaries

Qualtrics exposes additional product-specific, licensed, private, UI-only, and binary APIs. This project does not provide a dedicated semantic tool for every XM product endpoint. Authorized JSON API v3 endpoints can generally be reached through `qualtrics_api_request`; multipart survey imports and response exports have dedicated paths. Endpoint availability and accepted payloads still depend on the account's license, brand configuration, and API permissions.

Some survey features have no individual public mutation endpoint. Copying or importing a known-good survey is the reliable way to preserve features such as scoring or specialized presentation settings; `get_question_template` provides the analogous pattern for specialized question types.

## License

MIT
