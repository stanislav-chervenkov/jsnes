/**
 * Fast binary save/load for lockstep sync and checkpoint restore.
 * Avoids JSON.stringify / Array.from on large TypedArrays (unlike toJSON()).
 *
 * Wire format v1: magic "JSN1", total size, mapper id, then packed CPU / PPU /
 * PAPU / controllers, then UTF-8 JSON for mapper-specific state (same object
 * shape as mmap.toJSON()).
 */

import CPU from "./cpu.js";
import PPU from "./ppu/index.js";
import PAPU from "./papu/index.js";
import Controller from "./controller.js";
import ChannelDM from "./papu/channel-dm.js";
import ChannelNoise from "./papu/channel-noise.js";
import ChannelSquare from "./papu/channel-square.js";
import ChannelTriangle from "./papu/channel-triangle.js";

/* global TextEncoder, TextDecoder */

const FORMAT_VERSION = 1;
const MAGIC = [0x4a, 0x53, 0x4e, 0x31]; // "JSN1"

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const PAPU_CHANNEL_SPECS = [
  ["dmc", ChannelDM],
  ["noise", ChannelNoise],
  ["square1", ChannelSquare],
  ["square2", ChannelSquare],
  ["triangle", ChannelTriangle],
];

function writeU32(dv, offset, v) {
  dv.setUint32(offset, v >>> 0, true);
  return offset + 4;
}

function readU32(dv, offset) {
  return { value: dv.getUint32(offset, true), offset: offset + 4 };
}

function writeScalar(v, buf, offset, dv) {
  if (v === null) {
    buf[offset++] = 0;
    return offset;
  }
  if (typeof v === "boolean") {
    buf[offset++] = 1;
    buf[offset++] = v ? 1 : 0;
    return offset;
  }
  if (typeof v === "number") {
    buf[offset++] = 2;
    dv.setFloat64(offset, v, true);
    return offset + 8;
  }
  throw new Error(`fast-state: unsupported scalar type ${typeof v}`);
}

function readScalar(buf, offset, dv) {
  const tag = buf[offset++];
  if (tag === 0) {
    return { value: null, offset };
  }
  if (tag === 1) {
    return { value: buf[offset++] !== 0, offset };
  }
  if (tag === 2) {
    return { value: dv.getFloat64(offset, true), offset: offset + 8 };
  }
  throw new Error(`fast-state: bad scalar tag ${tag}`);
}

function writeTypedArray(v, buf, offset, dv) {
  const len = v.byteLength;
  offset = writeU32(dv, offset, len);
  buf.set(new Uint8Array(v.buffer, v.byteOffset, len), offset);
  return offset + len;
}

function readTypedArrayInto(v, buf, offset, dv) {
  const r = readU32(dv, offset);
  offset = r.offset;
  const len = r.value;
  if (len !== v.byteLength) {
    throw new Error(
      `fast-state: typed array length mismatch (${len} vs ${v.byteLength})`,
    );
  }
  const src = buf.subarray(offset, offset + len);
  new Uint8Array(v.buffer, v.byteOffset, v.byteLength).set(src);
  return offset + len;
}

function writePlainArray(v, buf, offset, dv) {
  offset = writeU32(dv, offset, v.length);
  for (let i = 0; i < v.length; i++) {
    dv.setFloat64(offset, v[i], true);
    offset += 8;
  }
  return offset;
}

function readPlainArrayInto(v, buf, offset, dv) {
  const r = readU32(dv, offset);
  offset = r.offset;
  const len = r.value;
  if (len !== v.length) {
    throw new Error(
      `fast-state: plain array length mismatch (${len} vs ${v.length})`,
    );
  }
  for (let i = 0; i < len; i++) {
    v[i] = dv.getFloat64(offset, true);
    offset += 8;
  }
  return offset;
}

function writeProp(obj, prop, buf, offset, dv) {
  const v = obj[prop];
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    return writeTypedArray(v, buf, offset, dv);
  }
  if (Array.isArray(v)) {
    return writePlainArray(v, buf, offset, dv);
  }
  return writeScalar(v, buf, offset, dv);
}

function readProp(obj, prop, buf, offset, dv) {
  const v = obj[prop];
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    return readTypedArrayInto(v, buf, offset, dv);
  }
  if (Array.isArray(v)) {
    return readPlainArrayInto(v, buf, offset, dv);
  }
  const r = readScalar(buf, offset, dv);
  obj[prop] = r.value;
  return r.offset;
}

function writeProps(obj, PropsClass, buf, offset, dv) {
  for (let i = 0; i < PropsClass.JSON_PROPERTIES.length; i++) {
    offset = writeProp(obj, PropsClass.JSON_PROPERTIES[i], buf, offset, dv);
  }
  return offset;
}

function readProps(obj, PropsClass, buf, offset, dv) {
  for (let i = 0; i < PropsClass.JSON_PROPERTIES.length; i++) {
    offset = readProp(obj, PropsClass.JSON_PROPERTIES[i], buf, offset, dv);
  }
  return offset;
}

function writeNameTables(ppu, buf, offset, dv) {
  for (let i = 0; i < ppu.nameTable.length; i++) {
    const nt = ppu.nameTable[i];
    offset = writeTypedArray(nt.tile, buf, offset, dv);
    offset = writeTypedArray(nt.attrib, buf, offset, dv);
  }
  return offset;
}

function readNameTables(ppu, buf, offset, dv) {
  for (let i = 0; i < ppu.nameTable.length; i++) {
    const nt = ppu.nameTable[i];
    offset = readTypedArrayInto(nt.tile, buf, offset, dv);
    offset = readTypedArrayInto(nt.attrib, buf, offset, dv);
  }
  return offset;
}

function writePtTiles(ppu, buf, offset, dv) {
  for (let i = 0; i < ppu.ptTile.length; i++) {
    const t = ppu.ptTile[i];
    offset = writeTypedArray(t.opaque, buf, offset, dv);
    offset = writeTypedArray(t.pix, buf, offset, dv);
  }
  return offset;
}

function readPtTiles(ppu, buf, offset, dv) {
  for (let i = 0; i < ppu.ptTile.length; i++) {
    const t = ppu.ptTile[i];
    offset = readTypedArrayInto(t.opaque, buf, offset, dv);
    offset = readTypedArrayInto(t.pix, buf, offset, dv);
  }
  return offset;
}

function writeMapperJson(mmap, buf, offset, dv) {
  const json = JSON.stringify(mmap.toJSON());
  const bytes = textEncoder.encode(json);
  offset = writeU32(dv, offset, bytes.length);
  buf.set(bytes, offset);
  return offset + bytes.length;
}

function mapperJsonByteLength(mmap) {
  const json = JSON.stringify(mmap.toJSON());
  return 4 + textEncoder.encode(json).byteLength;
}

function readMapperJson(mmap, buf, offset, dv) {
  const r = readU32(dv, offset);
  offset = r.offset;
  const len = r.value;
  const jsonStr = textDecoder.decode(buf.subarray(offset, offset + len));
  mmap.fromJSON(JSON.parse(jsonStr));
  return offset + len;
}

function writePayload(nes, buf, dv) {
  let offset = 16;
  offset = writeProps(nes.cpu, CPU, buf, offset, dv);
  offset = writeProps(nes.ppu, PPU, buf, offset, dv);
  offset = writeNameTables(nes.ppu, buf, offset, dv);
  offset = writePtTiles(nes.ppu, buf, offset, dv);
  offset = writeProps(nes.papu, PAPU, buf, offset, dv);
  for (let i = 0; i < PAPU_CHANNEL_SPECS.length; i++) {
    const key = PAPU_CHANNEL_SPECS[i][0];
    const Cls = PAPU_CHANNEL_SPECS[i][1];
    offset = writeProps(nes.papu[key], Cls, buf, offset, dv);
  }
  offset = writeProps(nes.controllers[1], Controller, buf, offset, dv);
  offset = writeProps(nes.controllers[2], Controller, buf, offset, dv);
  offset = writeMapperJson(nes.mmap, buf, offset, dv);
  return offset;
}

function readPayload(nes, buf, dv) {
  let offset = 16;
  offset = readProps(nes.cpu, CPU, buf, offset, dv);
  offset = readProps(nes.ppu, PPU, buf, offset, dv);
  offset = readNameTables(nes.ppu, buf, offset, dv);
  offset = readPtTiles(nes.ppu, buf, offset, dv);
  offset = readProps(nes.papu, PAPU, buf, offset, dv);
  for (let i = 0; i < PAPU_CHANNEL_SPECS.length; i++) {
    const key = PAPU_CHANNEL_SPECS[i][0];
    const Cls = PAPU_CHANNEL_SPECS[i][1];
    offset = readProps(nes.papu[key], Cls, buf, offset, dv);
  }
  offset = readProps(nes.controllers[1], Controller, buf, offset, dv);
  offset = readProps(nes.controllers[2], Controller, buf, offset, dv);
  offset = readMapperJson(nes.mmap, buf, offset, dv);

  for (let i = 0; i < nes.ppu.spriteMem.length; i++) {
    nes.ppu.spriteRamWriteUpdate(i, nes.ppu.spriteMem[i]);
  }
  return offset;
}

/**
 * Exact byte length of a snapshot for the current NES (mapper JSON tail varies).
 */
export function getFastStateByteLength(nes) {
  if (!nes.mmap) {
    throw new Error("fast-state: load a ROM before measuring state size.");
  }
  let n = 16;
  n += measureProps(nes.cpu, CPU);
  n += measureProps(nes.ppu, PPU);
  n += measureNameTables(nes.ppu);
  n += measurePtTiles(nes.ppu);
  n += measureProps(nes.papu, PAPU);
  for (let i = 0; i < PAPU_CHANNEL_SPECS.length; i++) {
    const key = PAPU_CHANNEL_SPECS[i][0];
    const Cls = PAPU_CHANNEL_SPECS[i][1];
    n += measureProps(nes.papu[key], Cls);
  }
  n += measureProps(nes.controllers[1], Controller);
  n += measureProps(nes.controllers[2], Controller);
  n += mapperJsonByteLength(nes.mmap);
  return n;
}

function measureProp(obj, prop) {
  const v = obj[prop];
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    return 4 + v.byteLength;
  }
  if (Array.isArray(v)) {
    return 4 + v.length * 8;
  }
  if (v === null) {
    return 1;
  }
  if (typeof v === "boolean") {
    return 2;
  }
  if (typeof v === "number") {
    return 1 + 8;
  }
  throw new Error(`fast-state: unsupported scalar type ${typeof v}`);
}

function measureProps(obj, PropsClass) {
  let n = 0;
  for (let i = 0; i < PropsClass.JSON_PROPERTIES.length; i++) {
    n += measureProp(obj, PropsClass.JSON_PROPERTIES[i]);
  }
  return n;
}

function measureNameTables(ppu) {
  let n = 0;
  for (let i = 0; i < ppu.nameTable.length; i++) {
    const nt = ppu.nameTable[i];
    n += 4 + nt.tile.byteLength;
    n += 4 + nt.attrib.byteLength;
  }
  return n;
}

function measurePtTiles(ppu) {
  let n = 0;
  for (let i = 0; i < ppu.ptTile.length; i++) {
    const t = ppu.ptTile[i];
    n += 4 + t.opaque.byteLength;
    n += 4 + t.pix.byteLength;
  }
  return n;
}

function writeHeader(buf, dv, totalSize, mapperType) {
  for (let i = 0; i < 4; i++) {
    buf[i] = MAGIC[i];
  }
  writeU32(dv, 4, totalSize);
  dv.setUint16(8, FORMAT_VERSION, true);
  dv.setUint16(10, mapperType & 0xffff, true);
  dv.setUint32(12, 0, true);
}

function verifyHeader(buf, dv, nes) {
  for (let i = 0; i < 4; i++) {
    if (buf[i] !== MAGIC[i]) {
      throw new Error("fast-state: invalid magic (not a JSNES fast snapshot).");
    }
  }
  const totalSize = dv.getUint32(4, true);
  if (totalSize !== buf.byteLength) {
    throw new Error(
      `fast-state: length mismatch (${buf.byteLength} vs ${totalSize}).`,
    );
  }
  const ver = dv.getUint16(8, true);
  if (ver !== FORMAT_VERSION) {
    throw new Error(`fast-state: unsupported format version ${ver}.`);
  }
  const mapperType = dv.getUint16(10, true);
  if (!nes.rom || mapperType !== (nes.rom.mapperType & 0xffff)) {
    throw new Error("fast-state: mapper id does not match loaded ROM.");
  }
}

/**
 * Encode full emulator state into a new Uint8Array (suitable for sockets).
 */
export function saveFastState(nes) {
  if (!nes.mmap) {
    throw new Error("fast-state: load a ROM before saving.");
  }
  const len = getFastStateByteLength(nes);
  const buf = new Uint8Array(len);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  writeHeader(buf, dv, len, nes.rom.mapperType);
  const end = writePayload(nes, buf, dv);
  if (end !== len) {
    throw new Error(`fast-state: internal size error (${end} vs ${len}).`);
  }
  return buf;
}

/**
 * Restore state from a buffer produced by saveFastState (same ROM must be loaded).
 * Does not call reset(); overwrites existing CPU/PPU/PAPU/mapper/controllers in place.
 */
export function loadFastState(nes, buf) {
  if (!nes.mmap) {
    throw new Error("fast-state: load a ROM before loading snapshot.");
  }
  if (!(buf instanceof Uint8Array)) {
    buf = new Uint8Array(buf);
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  verifyHeader(buf, dv, nes);
  const end = readPayload(nes, buf, dv);
  if (end !== buf.byteLength) {
    throw new Error(`fast-state: trailing bytes (${buf.byteLength - end}).`);
  }
}

/**
 * Copy snapshot bytes into an existing buffer.
 * @param {number} [knownLength] If set, skips measuring (e.g. same value as last getFastStateByteLength).
 * @returns {number} bytes written
 */
export function saveFastStateInto(nes, outBuf, outOffset = 0, knownLength) {
  if (!nes.mmap) {
    throw new Error("fast-state: load a ROM before saving.");
  }
  const len =
    knownLength !== undefined ? knownLength : getFastStateByteLength(nes);
  if (outBuf.byteLength - outOffset < len) {
    throw new Error("fast-state: output buffer too small.");
  }
  const slice = outBuf.subarray(outOffset, outOffset + len);
  const dv = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
  writeHeader(slice, dv, len, nes.rom.mapperType);
  const end = writePayload(nes, slice, dv);
  if (end !== len) {
    throw new Error(`fast-state: internal size error (${end} vs ${len}).`);
  }
  return len;
}
