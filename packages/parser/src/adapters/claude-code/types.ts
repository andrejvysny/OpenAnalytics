// Raw Claude Code JSONL event shapes. Only the fields we read.

export type RawEventType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'attachment'
  | 'last-prompt'
  | 'permission-mode'
  | 'agent-name'
  | 'custom-title'
  | 'file-history-snapshot'
  | 'queue-operation';

export interface RawCommon {
  type: RawEventType;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  userType?: string;
  promptId?: string;
}

export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface RawContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface RawAssistantMsg {
  role: 'assistant';
  model?: string;
  content?: RawContentBlock[];
  usage?: RawUsage;
}

export interface RawAssistant extends RawCommon {
  type: 'assistant';
  message: RawAssistantMsg;
  requestId?: string;
}

export interface RawUserMsg {
  role: 'user';
  content: string | RawContentBlock[];
}

export interface RawUser extends RawCommon {
  type: 'user';
  message: RawUserMsg;
}

export type RawEvent = RawAssistant | RawUser | (RawCommon & { type: RawEventType });
