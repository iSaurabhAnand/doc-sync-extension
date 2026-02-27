import * as vscode from 'vscode';

export interface ConfluencePage {
  id: string;
  title: string;
  body: string;
  version: number;
  spaceKey: string;
}

interface ConfluenceApiPage {
  id: string;
  title: string;
  body: {
    storage: {
      value: string;
    };
  };
  version: {
    number: number;
  };
  space: {
    key: string;
  };
}

interface ConfluenceApiComment {
  id: string;
  _links: {
    webui: string;
    base: string;
  };
}

export class ConfluenceClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor() {
    const config = vscode.workspace.getConfiguration('docSync');
    const baseUrl = config.get<string>('confluenceBaseUrl');
    const email = config.get<string>('confluenceEmail');
    const apiToken = config.get<string>('confluenceApiToken');

    if (!baseUrl) {
      throw new Error('docSync.confluenceBaseUrl is not configured');
    }
    if (!email) {
      throw new Error('docSync.confluenceEmail is not configured');
    }
    if (!apiToken) {
      throw new Error('docSync.confluenceApiToken is not configured');
    }

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authHeader = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
  }

  static extractPageId(url: string): string {
    // Format: /wiki/spaces/KEY/pages/123456 or /pages/123456
    const pathMatch = url.match(/\/pages\/(\d+)/);
    if (pathMatch) {
      return pathMatch[1];
    }

    // Format: ?pageId=123456 or &pageId=123456
    const queryMatch = url.match(/[?&]pageId=(\d+)/);
    if (queryMatch) {
      return queryMatch[1];
    }

    throw new Error(`Cannot extract page ID from URL: ${url}`);
  }

  async getPage(pageId: string): Promise<ConfluencePage> {
    const url = `${this.baseUrl}/rest/api/content/${pageId}?expand=body.storage,version,space`;

    const response = await fetch(url, {
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Confluence page ${pageId}: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json() as ConfluenceApiPage;

    const plainText = data.body.storage.value
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ')
      .trim();

    return {
      id: data.id,
      title: data.title,
      body: plainText,
      version: data.version.number,
      spaceKey: data.space.key,
    };
  }

  async postComment(pageId: string, markdownText: string): Promise<string> {
    const storageHtml = this.markdownToConfluenceStorage(markdownText);

    const payload = {
      type: 'comment',
      container: {
        id: pageId,
        type: 'page',
      },
      body: {
        storage: {
          value: storageHtml,
          representation: 'storage',
        },
      },
    };

    const url = `${this.baseUrl}/rest/api/content`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to post comment: ${response.status} ${response.statusText} — ${errorBody}`
      );
    }

    const result = await response.json() as ConfluenceApiComment;
    const base = result._links?.base ?? this.baseUrl;
    const webui = result._links?.webui ?? `/wiki/pages/viewpage.action?pageId=${pageId}`;
    return `${base}${webui}`;
  }

  private markdownToConfluenceStorage(markdown: string): string {
    const lines = markdown.split('\n');
    const output: string[] = [];
    let inList = false;

    for (const line of lines) {
      if (line.startsWith('## ')) {
        if (inList) { output.push('</ul>'); inList = false; }
        output.push(`<h2>${this.inlineMarkdown(line.slice(3))}</h2>`);
      } else if (line.startsWith('### ')) {
        if (inList) { output.push('</ul>'); inList = false; }
        output.push(`<h3>${this.inlineMarkdown(line.slice(4))}</h3>`);
      } else if (line.match(/^[-*] /)) {
        if (!inList) { output.push('<ul>'); inList = true; }
        output.push(`<li>${this.inlineMarkdown(line.slice(2))}</li>`);
      } else if (line.trim() === '') {
        if (inList) { output.push('</ul>'); inList = false; }
      } else {
        if (inList) { output.push('</ul>'); inList = false; }
        output.push(`<p>${this.inlineMarkdown(line)}</p>`);
      }
    }

    if (inList) {
      output.push('</ul>');
    }

    return output.join('\n');
  }

  private inlineMarkdown(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/✅/g, '<ac:emoticon ac:name="tick" />')
      .replace(/⚠️/g, '<ac:emoticon ac:name="warning" />')
      .replace(/🚨/g, '<ac:emoticon ac:name="cross" />');
  }
}
