// 최소 ZIP 만들기 — 압축 없이 저장(store)만. 엔진 내보내기처럼 텍스트 파일 몇 개를 한 번에 받게 할 때 쓴다 (DOM 없음)
// 파일 이름은 UTF-8(일반 플래그 11번 비트). 날짜는 고정(1980-01-01)이라 같은 내용이면 같은 바이트가 나온다.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name: 'dir/a.txt', data: string | Uint8Array }] → ZIP Uint8Array */
export function makeZip(files) {
  const enc = new TextEncoder();
  const entries = files.map(f => {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    return { name, data, crc: crc32(data) };
  });
  let size = 22;
  for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  let p = 0;
  const u16 = (v) => { dv.setUint16(p, v, true); p += 2; }, u32 = (v) => { dv.setUint32(p, v, true); p += 4; };
  const put = (b) => { out.set(b, p); p += b.length; };
  const DATE = 0x0021; // 1980-01-01
  for (const e of entries) {
    e.offset = p;
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(0); u16(DATE);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0);
    put(e.name); put(e.data);
  }
  const cd = p;
  for (const e of entries) {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(0); u16(DATE);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset);
    put(e.name);
  }
  const cdSize = p - cd;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(cdSize); u32(cd); u16(0);
  return out;
}

/** ZIP 읽기 (테스트·검증용, store만) → [{ name, data: Uint8Array, crcOk }] */
export function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder();
  let end = bytes.length - 22;
  while (end >= 0 && dv.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('ZIP 끝 레코드가 없습니다');
  const n = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('중앙 디렉터리 형식 오류');
    const crc = dv.getUint32(p + 16, true), len = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
    const data = bytes.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + len);
    out.push({ name, data, crcOk: crc32(data) === crc });
    p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}
