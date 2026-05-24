import type { Session } from '@oa/schema';
import { applyLine, finalize, newState, type AggregatorState } from './aggregate.js';

// Parse a complete transcript file content into a single Session.
// Caller is responsible for providing the session_id (== file basename without .jsonl).
export function parseTranscript(sessionId: string, content: string): Session {
  const state = newState(sessionId);
  for (const line of splitLines(content)) applyLine(state, line);
  return finalize(state);
}

// Incremental parse: feed lines into a state, get back the same state for further feeding.
export function feedLines(state: AggregatorState, lines: string[]): AggregatorState {
  for (const line of lines) applyLine(state, line);
  return state;
}

function* splitLines(text: string): Generator<string> {
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      yield text.slice(start, i);
      start = i + 1;
    }
  }
  if (start < text.length) yield text.slice(start);
}
