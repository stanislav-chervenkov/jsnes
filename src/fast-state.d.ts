import type { NES } from "./nes";

export function getFastStateByteLength(nes: NES): number;
export function saveFastState(nes: NES): Uint8Array;
export function loadFastState(nes: NES, data: Uint8Array | ArrayBuffer): void;
export function saveFastStateInto(
  nes: NES,
  outBuf: Uint8Array,
  outOffset?: number,
  knownLength?: number,
): number;
