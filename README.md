# Doc Sync Agent

A VS Code Copilot Chat extension that compares your workspace source code against Confluence documentation and posts a sync report as a comment on the page.

## Setup

1. Install the extension
2. Open VS Code Settings (`Cmd+,`) and search for **Doc Sync**
3. Configure the three required settings:
   - `docSync.confluenceBaseUrl` — e.g. `https://myorg.atlassian.net`
   - `docSync.confluenceEmail` — your Atlassian account email
   - `docSync.confluenceApiToken` — your API token from [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)

## Usage

Open GitHub Copilot Chat and use the `@doc-sync` participant with the `/check` command:

```
@doc-sync /check <confluence-url> [scope:<path>] [type:<hld|lld|auto>]
```

### Examples

```
@doc-sync /check https://myorg.atlassian.net/wiki/spaces/ENG/pages/123456

@doc-sync /check https://myorg.atlassian.net/wiki/spaces/ENG/pages/123456 scope:src/auth type:lld

@doc-sync /check https://myorg.atlassian.net/wiki/pages/viewpage.action?pageId=123456 type:hld
```

### Parameters

| Parameter | Description |
|-----------|-------------|
| `<confluence-url>` | Full URL of the Confluence page (required) |
| `scope:<path>` | Relative path within workspace to scope code reading (optional) |
| `type:hld` | Focus on architectural patterns, system boundaries, data flows |
| `type:lld` | Focus on class/function signatures, API contracts, data models |
| `type:auto` | Let the LLM determine the document type (default) |

## What It Does

1. Fetches the specified Confluence page content
2. Reads source code files from your workspace (or a scoped subdirectory)
3. Sends both to GPT-4o via GitHub Copilot for comparison
4. Streams the comparison report into the chat
5. Posts the report as a comment on the Confluence page

## Requirements

- VS Code 1.90+
- GitHub Copilot Chat extension installed and signed in
- Confluence Cloud account with API token
