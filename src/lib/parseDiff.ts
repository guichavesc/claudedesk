export type FileChangeStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export interface DiffFile {
  oldPath: string;
  newPath: string;
  displayPath: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  lines: string[];
}

// Parses raw `git diff` output into per-file chunks. Each file's hunk lines are kept
// as-is (with their leading +/-/@@ markers) so the caller can render them verbatim.
export function parseDiff(raw: string): DiffFile[] {
  if (!raw || !raw.trim()) return [];

  const lines = raw.split('\n');
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const line of lines) {
    const fileHeaderMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileHeaderMatch) {
      if (current) files.push(current);
      const [, oldPath, newPath] = fileHeaderMatch;
      current = {
        oldPath,
        newPath,
        displayPath: newPath || oldPath,
        status: 'modified',
        additions: 0,
        deletions: 0,
        binary: false,
        lines: [],
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith('new file mode')) {
      current.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'deleted';
      continue;
    }
    if (line.startsWith('rename from') || line.startsWith('rename to') || line.startsWith('similarity index')) {
      current.status = 'renamed';
      continue;
    }
    if (line.startsWith('Binary files ')) {
      current.binary = true;
      continue;
    }
    if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.additions++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.deletions++;
    }
    current.lines.push(line);
  }

  if (current) files.push(current);
  return files;
}

export interface StatusEntry {
  code: string;
  path: string;
}

// Parses `git status -s` short-format output (e.g. " M file.ts", "?? new.ts").
export function parseStatus(raw: string): StatusEntry[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => ({ code: line.slice(0, 2).trim(), path: line.slice(3) }));
}
