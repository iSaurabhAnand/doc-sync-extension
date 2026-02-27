import * as vscode from 'vscode';

export interface CodeSnapshot {
  files: Array<{ path: string; content: string }>;
  totalChars: number;
  truncated: boolean;
}

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build',
  '.next', 'coverage', '.idea', '.vscode', 'out',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.py', '.ts', '.tsx', '.js', '.jsx', '.go', '.rs', '.java',
  '.cpp', '.c', '.h', '.cs', '.rb', '.swift', '.kt', '.scala',
]);

const MAX_FILE_CHARS = 6000;
const MAX_TOTAL_CHARS = 80000;

export async function readWorkspaceCode(scopePath?: string): Promise<CodeSnapshot> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('No workspace folder is open');
  }

  const rootUri = workspaceFolders[0].uri;
  const startUri = scopePath
    ? vscode.Uri.joinPath(rootUri, scopePath)
    : rootUri;

  const snapshot: CodeSnapshot = { files: [], totalChars: 0, truncated: false };
  await collectFiles(startUri, rootUri.path, snapshot);
  return snapshot;
}

async function collectFiles(
  dirUri: vscode.Uri,
  rootPath: string,
  snapshot: CodeSnapshot,
): Promise<void> {
  if (snapshot.truncated) {
    return;
  }

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch {
    return;
  }

  // Sort for deterministic ordering
  entries.sort(([a], [b]) => a.localeCompare(b));

  for (const [name, type] of entries) {
    if (snapshot.truncated) {
      break;
    }

    if (type === vscode.FileType.Directory) {
      if (SKIP_DIRS.has(name)) {
        continue;
      }
      const subUri = vscode.Uri.joinPath(dirUri, name);
      await collectFiles(subUri, rootPath, snapshot);
    } else if (type === vscode.FileType.File) {
      const ext = getExtension(name);
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        continue;
      }

      const fileUri = vscode.Uri.joinPath(dirUri, name);
      const relativePath = fileUri.path.slice(rootPath.length).replace(/^\//, '');

      let content: string;
      try {
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        content = new TextDecoder('utf-8').decode(bytes);
      } catch {
        continue;
      }

      if (content.length > MAX_FILE_CHARS) {
        content = content.slice(0, MAX_FILE_CHARS) + '\n... [truncated]';
      }

      if (snapshot.totalChars + content.length > MAX_TOTAL_CHARS) {
        snapshot.truncated = true;
        break;
      }

      snapshot.files.push({ path: relativePath, content });
      snapshot.totalChars += content.length;
    }
  }
}

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex >= 0 ? filename.slice(dotIndex) : '';
}
