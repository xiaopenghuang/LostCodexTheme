import { Unzip, UnzipInflate } from 'fflate';

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
interface Entry { name: string; size: number; crc: number; method: number; directory: boolean }
const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  table[i] = value >>> 0;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function fileLimit(name: string): number {
  if (name === 'theme.json') return 1024 * 1024;
  if (name.endsWith('.json')) return 256 * 1024;
  if (name.endsWith('.css')) return 262144;
  if (name === 'LICENSE.txt' || name === 'manifest.sig') return 128 * 1024;
  return 10 * 1024 * 1024;
}

function directory(bytes: Uint8Array): Map<string, Entry> {
  if (bytes.length < 22 || bytes.length > MAX_ARCHIVE_BYTES) throw new Error('主题包大小不正确');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  function extras(start: number, length: number, limit: number) {
    const end = start + length;
    if (end > limit) throw new Error('主题包扩展字段越界');
    for (let offset = start; offset < end;) {
      if (offset + 4 > end || offset + 4 + u16(offset + 2) > end || u16(offset) === 1) throw new Error('主题包扩展字段损坏或使用 ZIP64');
      offset += 4 + u16(offset + 2);
    }
  }
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw new Error('主题包损坏或使用了分卷格式');
  const count = u16(end + 10), directoryStart = u32(end + 16);
  if (!count || count > 32 || directoryStart + u32(end + 12) !== end) throw new Error('主题包目录不完整或文件过多');
  const records = new Map<string, Entry>(), names = new Set<string>();
  const intervals: Array<[number, number]> = [];
  let position = directoryStart, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || u32(position) !== 0x02014b50) throw new Error('主题包目录记录损坏');
    const flags = u16(position + 8), method = u16(position + 10), crc = u32(position + 16);
    const compressed = u32(position + 20), size = u32(position + 24);
    const nameLength = u16(position + 28), extraLength = u16(position + 30), commentLength = u16(position + 32);
    const attributes = u32(position + 38), local = u32(position + 42);
    if (!nameLength || nameLength > 512 || position + 46 + nameLength + extraLength + commentLength > end
      || u16(position + 34) !== 0 || (flags & ~0x080e) !== 0 || ![0, 8].includes(method)
      || compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error('主题包使用了不支持的压缩或加密格式');
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameLength);
    if (!(flags & 0x800) && nameBytes.some(byte => byte > 127)) throw new Error('主题包文件名需要使用 UTF-8');
    let name: string;
    try { name = decoder.decode(nameBytes); } catch { throw new Error('主题包文件名编码已损坏'); }
    if (/[\\:\u0000-\u001f]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..')) throw new Error('主题包包含不安全的文件路径');
    const isDirectory = name.endsWith('/'), kind = (attributes >>> 16) & 0xf000;
    if ((kind && kind !== (isDirectory ? 0x4000 : 0x8000)) || (attributes & 0x400)) throw new Error('主题包不能包含链接或特殊文件');
    if (names.has(name.toLowerCase())) throw new Error('主题包包含重复文件');
    names.add(name.toLowerCase());
    extras(position + 46 + nameLength, extraLength, end);
    if (local + 30 > directoryStart || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) throw new Error('主题包文件头与目录不一致');
    const localNameLength = u16(local + 26), localExtraLength = u16(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength;
    if (localNameLength !== nameLength || dataStart + compressed > directoryStart
      || nameBytes.some((byte, offset) => byte !== bytes[local + 30 + offset])) throw new Error('主题包文件路径或大小不一致');
    extras(local + 30 + localNameLength, localExtraLength, directoryStart);
    for (const [offset, expected] of [[14, crc], [18, compressed], [22, size]]) {
      const actual = u32(local + offset);
      if (actual !== expected && (!(flags & 8) || actual !== 0)) throw new Error('主题包文件校验信息不一致');
    }
    if ((method === 0 && compressed !== size) || (isDirectory && size !== 0)) throw new Error('主题包文件长度不正确');
    intervals.push([local, dataStart + compressed]);
    expanded += size;
    if (expanded > 32 * 1024 * 1024) throw new Error('主题包解压后过大');
    records.set(name, { name, size, crc, method, directory: isDirectory });
    position += 46 + nameLength + extraLength + commentLength;
  }
  if (position !== end) throw new Error('主题包目录包含多余数据');
  intervals.sort((a, b) => a[0] - b[0]);
  if (intervals[0][0] !== 0 || intervals.some((interval, i) => i > 0 && interval[0] < intervals[i - 1][1])) throw new Error('主题包包含重叠数据或额外程序');
  const files = [...records.values()].filter(entry => !entry.directory);
  const wrapped = files.some(entry => entry.name.includes('/'));
  const wrapper = wrapped ? files[0]?.name.split('/')[0] : '';
  if (!files.length || (wrapped && (!wrapper || !/^[\p{L}\p{N} _.-]{1,80}$/u.test(wrapper) || /[. ]$/.test(wrapper)))) throw new Error('主题包目录结构不受支持');
  for (const entry of records.values()) {
    if (entry.directory) {
      if (!wrapped || entry.name !== `${wrapper}/`) throw new Error('主题包只能有一个顶层文件夹');
    } else {
      if (wrapped && !entry.name.startsWith(`${wrapper}/`)) throw new Error('主题包混合了多个目录');
      if (wrapped) entry.name = entry.name.slice(wrapper!.length + 1);
      if (!/^(theme\.json|manifest\.json|theme\.css|custom\.css|LICENSE\.txt|manifest\.sig|[a-zA-Z0-9_-]{1,100}\.(png|jpg|jpeg|webp))$/.test(entry.name)
        || entry.size > fileLimit(entry.name)) throw new Error('主题包包含不支持或过大的文件');
    }
  }
  return records;
}

export function readArchive(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const metadata = directory(bytes);
  return new Promise((resolve, reject) => {
    const files = new Map<string, Uint8Array>(), seen = new Set<string>();
    const inflaters: Array<{ terminate: () => void }> = [];
    let pending = 0, finished = false, failed = false;
    const fail = (error: unknown) => {
      if (failed) return; failed = true;
      for (const inflater of inflaters) inflater.terminate();
      reject(error instanceof Error ? error : new Error('主题包无法读取'));
    };
    const complete = () => {
      if (finished && !pending && !failed) {
        if (seen.size !== metadata.size) { fail(new Error('主题包文件不完整')); return; }
        resolve(files);
      }
    };
    const unzip = new Unzip(entry => {
      if (failed) return;
      const expected = metadata.get(entry.name);
      if (!expected || seen.has(entry.name) || entry.compression !== expected.method) { fail(new Error('主题包存在目录外文件或重复文件')); return; }
      seen.add(entry.name); pending++; inflaters.push(entry);
      const chunks: Uint8Array[] = []; let size = 0;
      entry.ondata = (error, chunk, final) => {
        if (failed) return;
        if (error) { fail(error); return; }
        size += chunk.length;
        if (size > expected.size) { fail(new Error('主题包解压长度与声明不符')); return; }
        chunks.push(chunk);
        if (final) {
          const data = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
          if (size !== expected.size || crc32(data) !== expected.crc) { fail(new Error('主题包文件校验失败')); return; }
          if (!expected.directory) files.set(expected.name, data);
          pending--; complete();
        }
      };
      entry.start();
    });
    unzip.register(UnzipInflate);
    void (async () => {
      for (let offset = 0; offset < bytes.length && !failed; offset += 4096) {
        unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
        if (offset && offset % (256 * 1024) === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      finished = true; complete();
      if (pending && !failed) fail(new Error('主题包压缩流没有完整结束'));
    })().catch(fail);
  });
}
