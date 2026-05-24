export const kind = 'claude-code' as const;
export { parseTranscript, feedLines } from './parse.js';
export { newState, applyLine, finalize, AggregatorIncompleteError } from './aggregate.js';
export type { AggregatorState } from './aggregate.js';
export { diffForToolUse } from './diff.js';
export type { DiffResult } from './diff.js';
