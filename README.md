# Qualtrics MCP Server

A Model Context Protocol (MCP) server that provides Claude Desktop with tools to interact with the Qualtrics API. This server enables survey management, response exports, and data analysis directly from Claude Desktop.

## Features

- **Survey Management**: List, view, and create Qualtrics surveys
- **Response Export**: Export survey responses with comprehensive filtering options
- **Large Data Handling**: Save exports to local files to avoid context limits
- **Rate Limiting**: Built-in rate limiting to respect Qualtrics API limits
- **Comprehensive Filtering**: Filter exports by date, completion status, specific questions, and more
- **Type Safety**: Full TypeScript implementation with Zod validation
- **Error Handling**: Comprehensive error handling and reporting

## Setup

### Prerequisites

- Node.js 18+ 
- Qualtrics API token with appropriate permissions
- Qualtrics data center ID

### Installation

1. Clone and install dependencies:
```bash
git clone <repository>
cd qualtrics-mcp-server
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your Qualtrics credentials
```

3. Build the project:
```bash
npm run build
```

### Configuration

Set the following environment variables in your `.env` file:

- `QUALTRICS_API_TOKEN`: Your Qualtrics API token
- `QUALTRICS_DATA_CENTER`: Your Qualtrics data center ID (e.g., "yourdatacenterid")
- `QUALTRICS_BASE_URL`: (Optional) Custom base URL if using a different instance
- `RATE_LIMITING_ENABLED`: Enable/disable rate limiting (default: true)
- `RATE_LIMIT_RPM`: Requests per minute limit (default: 50)
- `REQUEST_TIMEOUT`: Request timeout in milliseconds (default: 30000)

### Claude Desktop Integration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "qualtrics": {
      "command": "node",
      "args": ["/path/to/qualtrics-mcp-server/build/index.js"],
      "env": {
        "QUALTRICS_API_TOKEN": "your_api_token",
        "QUALTRICS_DATA_CENTER": "your_data_center_id"
      }
    }
  }
}
```

## Available Tools

### Survey Tools
- `list_surveys` - List surveys with optional filtering and pagination
- `get_survey` - Get detailed information about a specific survey
- `create_survey` - Create a new survey in Qualtrics

### Response Export Tools
- `export_responses` - Export survey responses (warns about large files)
- `export_responses_filtered` - Export with filters to reduce data size (recommended)
- `check_export_status` - Check the status of a response export job

## Usage Examples

### List Surveys
```json
{
  "offset": 0,
  "limit": 10,
  "filter": "customer satisfaction"
}
```

### Export Filtered Responses
For large surveys, use the filtered export to avoid context limits:

```json
{
  "surveyId": "SV_123456789",
  "format": "csv",
  "saveToFile": "survey_responses.csv",
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "filterType": "complete",
  "questionIds": ["QID1", "QID2", "QID5"],
  "useLabels": true
}
```

### Available Filters
- **Date Range**: `startDate`, `endDate` (ISO format)
- **Completion Status**: `filterType` (complete/incomplete/all)
- **Question Selection**: `questionIds` (array of question IDs)
- **Embedded Data**: `embeddedDataIds` (specific fields)
- **Format Options**: `useLabels`, `includeDisplayOrder`
- **File Output**: `saveToFile` (recommended for large exports)

## Best Practices

1. **Use Filtered Exports**: For surveys with many responses, always use `export_responses_filtered` with appropriate filters
2. **Save Large Files**: Use the `saveToFile` parameter for exports to avoid context limits
3. **Date Filtering**: Use date ranges to limit the data to what you need
4. **Question Selection**: Specify `questionIds` to export only relevant questions
5. **Rate Limiting**: The server respects Qualtrics API rate limits automatically

## Troubleshooting

### Common Issues

1. **"Unexpected token 'Q'"**: Remove any `console.log` statements that interfere with JSON protocol
2. **"Read-only file system"**: Use absolute paths or let the server save to your home directory
3. **Large file timeouts**: Use filtered exports with date ranges and question selection
4. **API rate limits**: The server handles rate limiting automatically

## Development

Run in development mode:
```bash
npm run dev
```

Test with MCP Inspector:
```bash
npm run inspector
```

## Usage Examples

Once configured with Claude Desktop:

- "List my Qualtrics surveys"
- "Get details for survey SV_123456789"
- "Create a new survey called 'Customer Satisfaction Q2 2025'"
- "Export responses from survey SV_123456789 in CSV format"

## License

MIT