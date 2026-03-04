# Doc Sync Agent

A VS Code Copilot Chat extension that compares your workspace source code against Confluence documentation and posts a sync report as a comment on the page. The agent automatically explores the codebase — reading only the files relevant to the documentation — before producing its report.

## Requirements

- VS Code 1.95+
- GitHub Copilot Chat extension installed and signed in
- Confluence Cloud or Data Center account with an API token / PAT

---

## Install from VSIX

1. Build the extension (see [Build from Source](#build-from-source)) or download a pre-built `.vsix`
2. In VS Code, open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run **Extensions: Install from VSIX…** and select the `.vsix` file
4. Reload VS Code when prompted

---

## Build from Source

**Prerequisites:** Node.js 18+ and npm

```bash
# 1. Clone the repo
git clone https://github.com/doc-sync/doc-sync-agent
cd doc-sync-agent

# 2. Install dependencies
npm install

# 3. Compile TypeScript
npm run build

# 4. Package into a .vsix (requires @vscode/vsce, already a dev dependency)
npx vsce package
```

This produces a `doc-sync-agent-<version>.vsix` file in the project root. Install it using the steps above.

### Development (run in Extension Host)

Open the project in VS Code and press **F5** (or **Run → Start Debugging**). This opens a new VS Code window with the extension loaded from source.

---

## Configuration

Open VS Code Settings (`Cmd+,` / `Ctrl+,`) and search for **Doc Sync**.

| Setting | Required | Description |
|---|---|---|
| `docSync.confluenceBaseUrl` | Yes | e.g. `https://myorg.atlassian.net` |
| `docSync.confluenceEmail` | Cloud only | Your Atlassian account email. Leave empty for Data Center / Server (PAT auth). |
| `docSync.confluenceApiToken` | Yes | Cloud: API token from [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens). Data Center/Server: Personal Access Token (PAT). |
| `docSync.model` | No | Language model to use via Copilot. Default: `gpt-4o` (free via GitHub Copilot). Options: `gpt-4o`, `gpt-4o-mini`, `o1`, `o1-mini`, `gpt-4`. |

---

## Usage

Open GitHub Copilot Chat and use the `@doc-sync` participant:

```
@doc-sync /check <confluence-url> [scope:<path>] [type:<hld|lld|auto>]
@doc-sync /version
```

### Examples

```
@doc-sync /check https://myorg.atlassian.net/wiki/spaces/ENG/pages/123456

@doc-sync /check https://myorg.atlassian.net/wiki/spaces/ENG/pages/123456 scope:src/auth type:lld

@doc-sync /check https://myorg.atlassian.net/wiki/pages/viewpage.action?pageId=123456 type:hld
```

### Parameters

| Parameter | Description |
|---|---|
| `<confluence-url>` | Full URL of the Confluence page (required) |
| `scope:<path>` | Limit code exploration to a subdirectory relative to workspace root (optional) |
| `type:hld` | Focus on architectural patterns, system boundaries, data flows |
| `type:lld` | Focus on class/function signatures, API contracts, data models |
| `type:auto` | Let the model determine the document type (default) |

---

## How It Works

1. Fetches the specified Confluence page content
2. The agent lists workspace files and reads the ones relevant to the documentation
3. Streams the analysis and final sync report into chat
4. Posts the report as a comment on the Confluence page

The agent uses tool calling to explore the codebase iteratively — it does not read all files upfront, making it more efficient on large repositories.

---

## Changelog

### 1.1.0
- Agent mode: model now explores the codebase using tools (`list_workspace_files`, `read_workspace_file`) instead of reading everything upfront
- Configurable model (`docSync.model`) — defaults to `gpt-4o` (free via GitHub Copilot)
- `/version` command
- Report now lists files analyzed

### 1.0.0
- Initial release
