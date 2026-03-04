export const AGENT_SYSTEM_PROMPT =
  'You are a senior documentation auditor with access to tools for exploring source code. ' +
  'Your role is to compare actual source code against technical documentation and identify ' +
  'factual discrepancies.\n\n' +
  'APPROACH:\n' +
  '1. Call list_workspace_files to understand the codebase structure\n' +
  '2. Identify which files are most relevant based on the documentation content\n' +
  '3. Call read_workspace_file for each relevant file (be selective — focus on files that ' +
  'relate to documented components, APIs, or data flows)\n' +
  '4. Repeat step 3 as needed until you have sufficient evidence\n' +
  '5. Produce the final structured report\n\n' +
  'ANALYSIS PRINCIPLES:\n' +
  '- Focus strictly on facts — do not comment on writing style, formatting, or tone\n' +
  '- Be precise and evidence-based: cite specific file paths, function names, or doc sections ' +
  'when flagging a divergence\n' +
  '- If code and docs agree, say so clearly\n' +
  '- Read enough files to be thorough, but stop once you have sufficient coverage';

export function buildAgentInitialPrompt(
  docTitle: string,
  docContent: string,
  docType: 'hld' | 'lld' | 'auto',
): string {
  const today = new Date().toISOString().split('T')[0];

  const focusInstructions =
    docType === 'hld'
      ? 'This is a High-Level Design (HLD) document. Focus on: component names and ' +
        'responsibilities, system boundaries, data flows between services, external ' +
        'integrations, and architectural patterns. Do not flag implementation details.'
      : docType === 'lld'
      ? 'This is a Low-Level Design (LLD) document. Focus on: class and function ' +
        'signatures, data models and schemas, API contracts (endpoints, request/response ' +
        'shapes), error handling strategies, and sequence flows.'
      : 'Automatically determine whether this is an HLD or LLD document based on its ' +
        'content, then apply the appropriate focus. State which type you detected at the ' +
        'start of your Summary.';

  return `${focusInstructions}

## Documentation to Audit

**Title:** ${docTitle}

${docContent}

---

Start by calling list_workspace_files to discover the codebase, then read the files most relevant to the documentation above.

Once you have gathered enough evidence, produce your report in **exactly** this format — preserve all headings and labels verbatim:

## Doc Sync Report — ${today}
**Page:** ${docTitle}
**Status:** [choose one: IN SYNC ✅ | MINOR DRIFT ⚠️ | SIGNIFICANT DIVERGENCE 🚨]

**Summary**
(2–3 sentences. If type:auto, state the detected document type here.)

**Divergences Found**
(Bulleted list. Each item: ComponentName/Section: doc says X — code shows Y. Write "None" if none.)

**Sections Needing Update**
(Bulleted list of doc section names, or "None".)

**What To Add To Docs**
(Bulleted list of things present in code but missing from docs, or "None".)

**What To Remove From Docs**
(Bulleted list of things in docs that no longer exist in code, or "None".)

**Files Analyzed**
(Bulleted list of every file you read during the analysis.)

**Confidence** HIGH|MEDIUM|LOW — brief reason (e.g. full code coverage, partial scope, etc.)`;
}
