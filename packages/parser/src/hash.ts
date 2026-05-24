// FNV-1a 64-bit hash. Output: 16 lowercase hex chars. Must match vibenal/src/hash.rs bit-exactly.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function fnv1aHex(input: string): string {
  let hash = FNV_OFFSET;
  const bytes = new TextEncoder().encode(input);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]!);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}
