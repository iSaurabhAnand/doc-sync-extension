import type { CodeSnapshot } from './codeReader.js';

export const SYSTEM_PROMPT =
  'You are a documentation auditor. Your role is to compare source code against ' +
  'technical documentation and identify factual discrepancies. Focus strictly on ' +
  'facts — do not comment on writing style, formatting, or tone. Be precise and ' +
  'evidence-based: cite specific file paths, function names, or doc sections when ' +
  'flagging a divergence. If the code and doc agree, say so clearly.';

export function buildComparisonPrompt(
  docTitle: string,
  docContent: string,
  codeSnapshot: CodeSnapshot,
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

  const truncationNote = codeSnapshot.truncated
    ? '\n\n> **Note:** The code snapshot was truncated at 80,000 characters. ' +
      'Some files may be missing from the analysis.'
    : '';

  const codeSection = codeSnapshot.files
    .map(f => `### File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  return `${focusInstructions}

## Documentation to Audit

**Title:** ${docTitle}

${docContent}

## Source Code (${codeSnapshot.files.length} file${codeSnapshot.files.length === 1 ? '' : 's'}, ${codeSnapshot.totalChars.toLocaleString()} chars)${truncationNote}

${codeSection}

---

Produce a report in **exactly** this format — preserve all headings and labels verbatim:

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

**Confidence** HIGH|MEDIUM|LOW — brief reason (e.g. full code coverage, partial scope, etc.)`;
}
