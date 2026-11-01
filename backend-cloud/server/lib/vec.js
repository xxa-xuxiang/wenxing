// 问星 v1.1 — 向量 Float32 BLOB 编解码（SQLite Bytes 列）
// 存 BLOB 而非 JSON：1024 维 × 4 字节 ≈ 4KB/条，50 万题约 2GB（JSON 文本约 3-4 倍体积）

/** number[] → Buffer(Float32 LE) */
export function vecToBlob(vec) {
  const f32 = new Float32Array(vec)
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)
}

/** Prisma Bytes(Uint8Array/Buffer) → number[] */
export function blobToVec(buf) {
  if (!buf) return []
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const f32 = new Float32Array(b.buffer, b.byteOffset, b.length / 4)
  return Array.from(f32)
}
