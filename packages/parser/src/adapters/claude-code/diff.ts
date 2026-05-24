// Compute (added, removed) line counts from a single tool_use input.
// We intentionally never store any file content — only counts and the file extension.

export interface DiffResult {
  added: number;
  removed: number;
  ext: string | null;
}

function countLines(s: unknown): number {
  if (typeof s !== 'string' || s.length === 0) return 0;
  // Count newlines + 1 (treat content without trailing newline as one line).
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return s.endsWith('\n') ? n : n + 1;
}

function extractExt(filePath: unknown): string | null {
  if (typeof filePath !== 'string') return null;
  const slashIdx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const base = slashIdx >= 0 ? filePath.slice(slashIdx + 1) : filePath;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

export function diffForToolUse(
  toolName: string,
  input: Record<string, unknown> | undefined,
): DiffResult | null {
  if (!input) return null;
  const ext = extractExt(input.file_path);

  if (toolName === 'Write') {
    return { added: countLines(input.content), removed: 0, ext };
  }

  if (toolName === 'Edit') {
    return {
      added: countLines(input.new_string),
      removed: countLines(input.old_string),
      ext,
    };
  }

  if (toolName === 'NotebookEdit') {
    return {
      added: countLines(input.new_source),
      removed: countLines(input.old_source ?? ''),
      ext,
    };
  }

  return null;
}
