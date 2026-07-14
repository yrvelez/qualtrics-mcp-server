# API coverage

This document describes the tools currently registered by the server. The exact total is **110**: **108 Qualtrics action tools across 14 API areas** and **2 server controls**.

“Comprehensive survey programming” means an MCP client can create, structure, validate, configure, version, distribute, and retrieve data from complex questionnaires without importing the internal TypeScript client. It does not mean every API for every licensed Qualtrics XM product has a dedicated semantic wrapper.

## Exact inventory

### Surveys (8)

- `list_surveys`
- `get_survey`
- `create_survey`
- `estimate_export_size`
- `update_survey`
- `delete_survey`
- `activate_survey`
- `deactivate_survey`

### Survey design (11)

- `get_survey_metadata`
- `update_survey_metadata`
- `get_survey_options`
- `update_survey_options`
- `list_survey_versions`
- `get_survey_version`
- `create_survey_version`
- `get_survey_languages`
- `update_survey_languages`
- `get_survey_translations`
- `update_survey_translations`

Options, the `AvailableLanguages` option map, and translations use fetch-and-merge updates by default because their Qualtrics `PUT` operations expect complete resources. Callers must opt in to replacement semantics explicitly. Language writes use the documented survey-options resource; `/surveys/{id}/languages` is read-only.

### Questions (13)

- `list_questions`
- `get_question`
- `create_question`
- `update_question`
- `delete_question`
- `add_multiple_choice_question`
- `add_text_entry_question`
- `add_descriptive_text_question`
- `add_likert_question`
- `add_matrix_question`
- `add_rank_order_question`
- `add_constant_sum_question`
- `get_question_template`

Raw create/update tools accept additional Qualtrics fields for specialized definitions. Partial updates preserve the current full question. The template tool removes instance-specific IDs so a known-good specialized question can be cloned safely.

### Blocks (5)

- `list_blocks`
- `get_block`
- `create_block`
- `update_block`
- `delete_block`

Create and update accept complete `BlockElements`, `Options`, and additional block fields. Updates fetch and carry forward the current definition before applying a patch.

### Survey flow (12)

- `get_survey_flow`
- `update_survey_flow`
- `insert_flow_element`
- `update_flow_element`
- `move_flow_element`
- `delete_flow_element`
- `validate_survey_design`
- `add_embedded_data`
- `add_web_service`
- `piped_text_reference`
- `list_embedded_data`
- `list_web_services`

The element tools traverse nested flow trees, allocate collision-free IDs, and normalize `Properties.Count`. Raw full-tree replacement remains available for compact expression of complex branches, groups, and randomizers. Design validation checks flow IDs and counts, references, reachability, and export tags before publication.

### Quotas (10)

- `list_quotas`
- `get_quota`
- `create_quota`
- `update_quota`
- `delete_quota`
- `list_quota_groups`
- `get_quota_group`
- `create_quota_group`
- `update_quota_group`
- `delete_quota_group`

Quota payload tools expose raw criteria and action structures so advanced quota logic is not limited to a simplified schema.
Deleting a quota group is a documented cascade that also deletes every quota in the group, so `delete_quota_group` requires both deletion confirmation and explicit cascade acknowledgement.

### Responses (8)

- `export_responses`
- `check_export_status`
- `download_export_file`
- `export_responses_filtered`
- `get_response`
- `create_response`
- `update_response`
- `delete_response`

Response export initiation is treated as a read operation even though Qualtrics uses `POST`. Large exports stream to a collision-safe filename in the user's fixed Downloads directory without retaining an unbounded body in memory; callers cannot select an arbitrary filesystem path or overwrite an existing file. Download timeouts apply to headers and each inactive chunk read rather than total transfer duration. Errors never silently launch a second fallback export. `update_response` uses Qualtrics's current asynchronous update job to change embedded data on one response and returns a progress endpoint; it does not claim to rewrite recorded answer values.

### Contacts (11)

- `list_mailing_lists`
- `get_mailing_list`
- `update_mailing_list`
- `create_mailing_list`
- `delete_mailing_list`
- `list_contacts`
- `get_contact`
- `add_contact`
- `update_contact`
- `remove_contact`
- `bulk_import_contacts`

Every contact tool uses the current XM Directory routes and requires `directoryId` (normally `POOL_...`); the retired legacy `/mailinglists` routes are not used. A caller can discover the directory ID through `qualtrics_api_request` with `GET /directories`. Mailing-list pages accept up to 100 records and contact pages up to 50; callers continue with `nextSkipToken`. `includeCount` is approximate and may reduce performance on large lists. `get_mailing_list` and `delete_mailing_list` do not support shared mailing lists. `remove_contact` removes only mailing-list membership, not the directory contact. Contact identity requirements vary by directory configuration, so creation accepts email, first/last name, or external data reference and leaves the exact matching rule to Qualtrics.

The bulk helper is intentionally bounded to 100 contacts and calls the documented single-contact endpoint sequentially. It returns per-contact outcomes and is not atomic, so an error can leave earlier contacts created.

### Distributions (8)

- `list_distributions`
- `get_distribution`
- `list_distribution_links`
- `create_anonymous_link`
- `create_email_distribution`
- `delete_distribution`
- `create_reminder`
- `create_thank_you`

Qualtrics documents that retrieving generated individual links can update contact-frequency state and reset email-status dates for some distribution types. Consequently, `list_distribution_links` is annotated as side-effecting and requires the `distributions` scope despite using `GET`.
`create_anonymous_link` is a read-only name retained for compatibility: it reads `BrandBaseURL` from the survey definition and constructs the canonical `/jfe/form/{surveyId}` URL without creating a distribution.

### Libraries (11)

- `list_libraries`
- `list_library_blocks`
- `list_library_questions`
- `list_library_surveys`
- `list_library_messages`
- `get_library_message`
- `create_library_message`
- `update_library_message`
- `delete_library_message`
- `upload_library_graphic`
- `delete_library_graphic`

These tools discover reusable survey blocks, questions, and surveys; manage multilingual invitation, reminder, thank-you, validation, and general messages; and upload or delete library graphics. Graphic upload accepts a public HTTPS URL or validated base64 JPEG, GIF, or PNG content. Base64 uploads are limited to 10 MB, and uploaded graphics should be treated as potentially public rather than confidential storage.

### Survey import and copy (5)

- `copy_survey`
- `import_survey_qsf`
- `import_survey_text`
- `import_survey_from_url`
- `import_survey_docx`

Local QSF, TXT, and DOCX content uses multipart form data without forcing a JSON content type. URL import accepts public HTTPS resources. DOCX content is validated as a ZIP-based document and limited to 25 MB when supplied through MCP as base64.

### Webhooks (3)

- `list_webhooks`
- `create_webhook`
- `delete_webhook`

### Users (2)

- `list_users`
- `get_user`

### Advanced API (1)

- `qualtrics_api_request`

This guarded escape hatch supports `GET`, `POST`, `PUT`, `PATCH`, and confirmed `DELETE` for JSON API v3 resources. It pins requests to the configured Qualtrics origin, encodes query parameters separately, and rejects paths that could change or escape the API base. Known route families retain their mapped least-privilege scope; writes to otherwise-unmapped endpoints require `advanced`.

### Server control (2)

- `set_write_scopes`
- `set_read_only_mode`

These are local MCP controls and do not call Qualtrics. They account for the difference between the 108 Qualtrics action tools and the 110 total tools.

## Write-scope routing

Most reads are allowed in the default read-only mode, including response-export initiation. The documented side-effecting `GET` behind `list_distribution_links` requires the `distributions` scope. Mutating requests are routed by endpoint family, not by whichever tool invoked the request, so the advanced tool cannot bypass a known route's normal scope.

| Scope | Risk | Mapped writes |
|---|---|---|
| `questionsAndBlocks` | Low | Questions and blocks under survey definitions |
| `surveyDesign` | Medium | Flow, options, versions, quotas, quota groups, languages, translations, event subscriptions |
| `libraries` | Medium | Reusable survey assets, messages, and graphics |
| `distributions` | Minimal | Distributions, links, invitations, reminders, thank-yous |
| `surveys` | High | Survey definitions and survey-level lifecycle, import, and copy operations |
| `contacts` | High | Mailing lists, directories, and contacts |
| `users` | High | User resources |
| `advanced` | High | Otherwise-unmapped JSON API writes |

At startup, `QUALTRICS_READ_ONLY` defaults to `true`, leaving the enabled-scope set empty. `set_write_scopes` is the preferred way to grant only what a task needs. `set_read_only_mode` is a compatibility convenience; disabling read-only mode grants all scopes.

## Questionnaire-programming guarantees

The dedicated construction tools are designed around Qualtrics resources that behave like full replacements:

- Question, block, option, language-map, and translation updates fetch and preserve omitted data where appropriate.
- Common question helpers generate a readable `DataExportTag` fallback, while explicit study-specific tags remain recommended for stable analysis.
- Matrix helpers enforce the Qualtrics distinction between `Choices` as rows and `Answers` as scale columns.
- Flow insertion and movement work inside nested groups and randomizers, while design validation catches structural mistakes before activation.
- QSF/TXT/DOCX import and survey copy preserve complex structures that do not have a reliable individual public mutation endpoint.

The MCP-only example in `examples/motivated-reasoning-study.ts` exercises these patterns and stops with an inactive draft version.

## Deliberate boundaries

- The server does not have a dedicated semantic tool for every product-specific Qualtrics endpoint, such as every directory, ticketing, workflow, or licensed XM product resource.
- `qualtrics_api_request` is a JSON API v3 mechanism, not an arbitrary HTTP client. It cannot target another origin, and it is not the multipart or binary path.
- Multipart survey import and response export/download use dedicated tools. Other binary endpoints may require a future dedicated implementation.
- APIs, fields, language translation, and product areas remain subject to the configured brand's license and the token's Qualtrics permissions.
- Private, UI-only, undocumented, or deprecated endpoints are not promised by this project.
- When a survey feature lacks an individual public mutation endpoint, copying or importing a known-good template is preferred. This is especially useful for scoring and specialized presentation behavior.

These boundaries keep the broad fallback useful without weakening origin restrictions, write-scope enforcement, payload handling, or deletion confirmations.
