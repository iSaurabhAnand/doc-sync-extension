import * as vscode from 'vscode';
import { ConfluenceClient } from './confluenceClient.js';
import { readWorkspaceCode } from './codeReader.js';
import { SYSTEM_PROMPT, buildComparisonPrompt } from './prompts.js';

const CONFIG_HELP = `
**Configuration required.** Open VS Code Settings (\`Cmd+,\` / \`Ctrl+,\`) and search for **Doc Sync**, then set:

- \`docSync.confluenceBaseUrl\` — e.g. \`https://myorg.atlassian.net\`
- \`docSync.confluenceEmail\` — your Atlassian account email
- \`docSync.confluenceApiToken\` — generate at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)
`;

const USAGE_HELP = `
**Usage:**
\`\`\`
@doc-sync /check <confluence-url> [scope:<path>] [type:<hld|lld|auto>]
\`\`\`

**Examples:**
\`\`\`
@doc-sync /check https://myorg.atlassian.net/wiki/spaces/ENG/pages/123456
@doc-sync /check https://myorg.atlassian.net/wiki/spaces/ENG/pages/123456 scope:src/auth type:lld
@doc-sync /check https://myorg.atlassian.net/wiki/pages/viewpage.action?pageId=123456 type:hld
\`\`\`

**Parameters:**
- \`scope:<path>\` — subdirectory to read (relative to workspace root)
- \`type:hld\` — focus on architecture, system boundaries, data flows
- \`type:lld\` — focus on classes, APIs, data models, error handling
- \`type:auto\` — let the model decide (default)
`;

async function handleRequest(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
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

  // ── Step 1: Fetch Confluence page ──────────────────────────────────────────
  stream.progress('Reading Confluence page...');
  const client = new ConfluenceClient();
  const pageId = ConfluenceClient.extractPageId(url);
  const page = await client.getPage(pageId);

  stream.markdown(
    `**Page:** ${page.title}  \n` +
    `**Version:** ${page.version} · **Space:** \`${page.spaceKey}\`\n\n`,
  );

  // ── Step 2: Read workspace code ────────────────────────────────────────────
  stream.progress('Reading workspace code...');
  const codeSnapshot = await readWorkspaceCode(scopePath);
  const scopeDesc = scopePath ? `\`${scopePath}\`` : 'entire workspace';

  stream.markdown(
    `**Code:** ${codeSnapshot.files.length} file${codeSnapshot.files.length === 1 ? '' : 's'} ` +
    `read from ${scopeDesc}` +
    (codeSnapshot.truncated ? ' _(snapshot truncated at 80 k chars)_' : '') +
    '\n\n',
  );

  // ── Step 3: Call GPT-4o via Copilot ───────────────────────────────────────
  stream.progress('Comparing code against docs (this may take ~30s)...');

  const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
  if (models.length === 0) {
    throw new Error(
      'No GPT-4o model is available via GitHub Copilot. ' +
      'Ensure the GitHub Copilot Chat extension is installed and you are signed in.',
    );
  }
  const model = models[0];

  const userMessageContent =
    SYSTEM_PROMPT + '\n\n' + buildComparisonPrompt(page.title, page.body, codeSnapshot, docType);

  const messages = [vscode.LanguageModelChatMessage.User(userMessageContent)];
  const response = await model.sendRequest(messages, {}, token);

  stream.markdown('---\n\n');

  let reportText = '';
  for await (const chunk of response.text) {
    stream.markdown(chunk);
    reportText += chunk;
  }

  // ── Step 4: Post comment to Confluence ────────────────────────────────────
  stream.progress('Posting comment to Confluence...');
  const pageUrl = await client.postComment(pageId, reportText);

  stream.markdown(
    `\n\n---\n**Comment posted to Confluence:** [View page](${pageUrl})\n`,
  );
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
