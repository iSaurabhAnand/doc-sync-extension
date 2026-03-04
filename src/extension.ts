import * as vscode from 'vscode';
import { ConfluenceClient } from './confluenceClient.js';
import { listWorkspaceFiles, readWorkspaceFile } from './codeReader.js';
import { AGENT_SYSTEM_PROMPT, buildAgentInitialPrompt } from './prompts.js';

const EXTENSION_VERSION = '1.1.0';
const MAX_AGENT_ITERATIONS = 10;

const CONFIG_HELP = `
**Configuration required.** Open VS Code Settings (\`Cmd+,\` / \`Ctrl+,\`) and search for **Doc Sync**, then set:

- \`docSync.confluenceBaseUrl\` — e.g. \`https://myorg.atlassian.net\`
- \`docSync.confluenceEmail\` — your Atlassian account email
- \`docSync.confluenceApiToken\` — generate at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)
- \`docSync.model\` — language model to use (default: \`gpt-4o\`)
`;

const USAGE_HELP = `
**Usage:**
\`\`\`
@doc-sync /check <confluence-url> [scope:<path>] [type:<hld|lld|auto>]
@doc-sync /version
\`\`\`

**Examples:**
\`\`\`
@doc-sync /check https://myorg.atlassian.net/wiki/spaces/ENG/pages/123456
@doc-sync /check https://myorg.atlassian.net/wiki/spaces/ENG/pages/123456 scope:src/auth type:lld
@doc-sync /check https://myorg.atlassian.net/wiki/pages/viewpage.action?pageId=123456 type:hld
\`\`\`

**Parameters:**
- \`scope:<path>\` — subdirectory to analyse (relative to workspace root)
- \`type:hld\` — focus on architecture, system boundaries, data flows
- \`type:lld\` — focus on classes, APIs, data models, error handling
- \`type:auto\` — let the model decide (default)

The agent will automatically explore the codebase using tools before producing its report.
`;

// ── Tools available to the agent ─────────────────────────────────────────────

const AGENT_TOOLS: vscode.LanguageModelChatTool[] = [
  {
    name: 'list_workspace_files',
    description:
      'List all source code files in the workspace or a scoped subdirectory. ' +
      'Call this first to understand the codebase structure, then decide which files to read.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description:
            'Optional subdirectory path relative to the workspace root (e.g. "src/auth"). ' +
            'Omit to list all workspace files.',
        },
      },
    },
  },
  {
    name: 'read_workspace_file',
    description:
      'Read the full contents of a specific source code file from the workspace. ' +
      'Use paths returned by list_workspace_files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file from the workspace root.',
        },
      },
      required: ['path'],
    },
  },
];

// ── Model selection ───────────────────────────────────────────────────────────

async function selectModel(modelFamily: string): Promise<vscode.LanguageModelChat> {
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: modelFamily });
  if (models.length === 0) {
    throw new Error(
      `No "${modelFamily}" model is available via GitHub Copilot. ` +
      'Ensure the GitHub Copilot Chat extension is installed and you are signed in. ' +
      'You can change the model in Settings under docSync.model.',
    );
  }
  return models[0];
}

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  defaultScope: string | undefined,
): Promise<string> {
  try {
    if (name === 'list_workspace_files') {
      const scope = (input['scope'] as string | undefined) ?? defaultScope;
      const files = await listWorkspaceFiles(scope);
      if (files.length === 0) {
        return 'No source code files found in the specified scope.';
      }
      return `Found ${files.length} file(s):\n${files.join('\n')}`;
    }

    if (name === 'read_workspace_file') {
      const path = input['path'] as string;
      if (!path) {
        return 'Error: "path" parameter is required.';
      }
      const content = await readWorkspaceFile(path);
      return `### File: ${path}\n\`\`\`\n${content}\n\`\`\``;
    }

    return `Unknown tool: ${name}`;
  } catch (err) {
    return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Agent loop ────────────────────────────────────────────────────────────────

async function runAgentLoop(
  model: vscode.LanguageModelChat,
  messages: vscode.LanguageModelChatMessage[],
  defaultScope: string | undefined,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<string> {
  let iterations = 0;
  let finalText = '';

  while (iterations < MAX_AGENT_ITERATIONS && !token.isCancellationRequested) {
    iterations++;

    const response = await model.sendRequest(messages, { tools: AGENT_TOOLS }, token);

    const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
    const toolCalls: vscode.LanguageModelToolCallPart[] = [];
    let iterationText = '';

    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        iterationText += chunk.value;
        stream.markdown(chunk.value);
        assistantParts.push(chunk);
      } else if (chunk instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push(chunk);
        assistantParts.push(chunk);
      }
    }

    if (toolCalls.length === 0) {
      // No tool calls — model produced its final response
      finalText = iterationText;
      break;
    }

    // Add assistant turn (may include text + tool calls)
    messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

    // Execute each tool and collect results
    const toolResultParts: vscode.LanguageModelToolResultPart[] = [];
    for (const tc of toolCalls) {
      stream.progress(`Agent: running ${tc.name}...`);
      const resultText = await executeToolCall(
        tc.name,
        tc.input as Record<string, unknown>,
        defaultScope,
      );
      toolResultParts.push(
        new vscode.LanguageModelToolResultPart(tc.callId, [
          new vscode.LanguageModelTextPart(resultText),
        ]),
      );
    }

    messages.push(vscode.LanguageModelChatMessage.User(toolResultParts));
  }

  return finalText;
}

// ── Main request handler ──────────────────────────────────────────────────────

async function handleRequest(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  // Handle /version command
  if (request.command === 'version') {
    stream.markdown(`**Doc Sync** v${EXTENSION_VERSION}`);
    return;
  }

  const prompt = request.prompt.trim();

  // Require a URL
  const urlMatch = prompt.match(/https?:\/\/\S+/);
  if (!urlMatch) {
    stream.markdown(USAGE_HELP);
    return;
  }
  const url = urlMatch[0];

  // Optional scope path
  const scopeMatch = prompt.match(/\bscope:(\S+)/);
  const scopePath = scopeMatch ? scopeMatch[1] : undefined;

  // Optional doc type (default: auto)
  const typeMatch = prompt.match(/\btype:(hld|lld|auto)\b/);
  const docType: 'hld' | 'lld' | 'auto' =
    typeMatch ? (typeMatch[1] as 'hld' | 'lld' | 'auto') : 'auto';

  // ── Step 1: Select model ───────────────────────────────────────────────────
  const config = vscode.workspace.getConfiguration('docSync');
  const modelFamily = config.get<string>('model') ?? 'gpt-4o';

  stream.progress(`Selecting model (${modelFamily})...`);
  const model = await selectModel(modelFamily);

  // ── Step 2: Fetch Confluence page ──────────────────────────────────────────
  stream.progress('Reading Confluence page...');
  const client = new ConfluenceClient();
  const pageId = ConfluenceClient.extractPageId(url);
  const page = await client.getPage(pageId);

  stream.markdown(
    `> **Doc Sync** v${EXTENSION_VERSION} · Model: \`${modelFamily}\`\n\n` +
    `**Page:** ${page.title}  \n` +
    `**Version:** ${page.version} · **Space:** \`${page.spaceKey}\`\n\n`,
  );

  // ── Step 3: Run agent ──────────────────────────────────────────────────────
  const scopeDesc = scopePath ? `\`${scopePath}\`` : 'entire workspace';
  stream.markdown(
    `**Scope:** ${scopeDesc} · **Doc type:** \`${docType}\`\n\n` +
    '---\n\n',
  );

  stream.progress('Agent: exploring codebase...');

  const initialMessage = AGENT_SYSTEM_PROMPT + '\n\n' + buildAgentInitialPrompt(page.title, page.body, docType);
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(initialMessage),
  ];

  const reportText = await runAgentLoop(model, messages, scopePath, stream, token);

  // ── Step 4: Post comment to Confluence ────────────────────────────────────
  if (reportText) {
    stream.progress('Posting comment to Confluence...');
    const pageUrl = await client.postComment(pageId, reportText);
    stream.markdown(
      `\n\n---\n**Comment posted to Confluence:** [View page](${pageUrl})\n`,
    );
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant(
    'doc-sync.agent',
    async (
      request: vscode.ChatRequest,
      _context: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken,
    ) => {
      try {
        await handleRequest(request, stream, token);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stream.markdown(`\n\n**Error:** ${message}\n`);

        const isConfigError =
          message.includes('confluenceBaseUrl') ||
          message.includes('confluenceEmail') ||
          message.includes('confluenceApiToken');

        if (isConfigError) {
          stream.markdown(CONFIG_HELP);
        }
      }
    },
  );

  context.subscriptions.push(participant);
}

export function deactivate(): void {
  // Nothing to clean up — subscriptions are disposed automatically
}
