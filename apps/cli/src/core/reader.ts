import { openSync, fstatSync, readSync, closeSync } from 'node:fs';

export interface ReadResult {
  text: string;
  newOffset: number;
  truncated: boolean; // file got smaller than cursor (rotation/rewrite); we re-read from 0
}

// Read `path` from `fromOffset` to EOF. Returns the new offset and any read text.
// If the file shrank below the cursor, re-reads from start (treats it as a fresh file).
export function readFrom(path: string, fromOffset: number): ReadResult {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    const size = stat.size;
    let start = fromOffset;
    let truncated = false;
    if (start > size) {
      start = 0;
      truncated = true;
    }
    if (start === size) {
      return { text: '', newOffset: size, truncated };
    }
    const len = size - start;
    const buf = Buffer.alloc(len);
    let read = 0;
    while (read < len) {
      const got = readSync(fd, buf, read, len - read, start + read);
      if (got === 0) break;
      read += got;
    }
    return { text: buf.toString('utf8', 0, read), newOffset: start + read, truncated };
  } finally {
    closeSync(fd);
  }
}
