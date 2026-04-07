import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "fs";
import NES from "../src/nes.js";
import { loadFastState, saveFastState } from "../src/fast-state.js";

describe("fast state (checkpoint / rewind)", function () {
  const romData = () =>
    fs.readFileSync("roms/croom/croom.nes").toString("binary");

  it("round-trips identical to toJSON stringification", function () {
    let nes = new NES();
    nes.loadROM(romData());
    nes.frame();
    nes.controllers[1].buttonDown(0);
    const before = JSON.stringify(nes.toJSON());
    const buf = saveFastState(nes);
    assert.strictEqual(buf.byteLength, nes.getFastStateByteLength());
    loadFastState(nes, buf);
    assert.strictEqual(JSON.stringify(nes.toJSON()), before);
  });

  it("exportFastStateSnapshot / importFastStateSnapshot matches save/load", function () {
    let nes = new NES();
    nes.loadROM(romData());
    nes.frame();
    const before = JSON.stringify(nes.toJSON());
    const copy = new NES();
    copy.loadROM(romData());
    copy.importFastStateSnapshot(nes.exportFastStateSnapshot());
    assert.strictEqual(JSON.stringify(copy.toJSON()), before);
  });

  it("rewindOneFrame restores saveRewindCheckpoint and can replay one frame", function () {
    let nes = new NES();
    nes.loadROM(romData());
    nes.saveRewindCheckpoint();
    nes.frame();
    const oneFrame = JSON.stringify(nes.toJSON());
    nes.rewindOneFrame();
    let fresh = new NES();
    fresh.loadROM(romData());
    assert.strictEqual(
      JSON.stringify(nes.toJSON()),
      JSON.stringify(fresh.toJSON()),
    );
    nes.frame();
    assert.strictEqual(JSON.stringify(nes.toJSON()), oneFrame);
  });

  it("saveFastStateInto writes a full snapshot", function () {
    let nes = new NES();
    nes.loadROM(romData());
    const n = nes.getFastStateByteLength();
    const out = new Uint8Array(n + 16);
    const written = nes.saveFastStateInto(out, 8, n);
    assert.strictEqual(written, n);
    let copy = new NES();
    copy.loadROM(romData());
    loadFastState(copy, out.subarray(8, 8 + written));
    assert.strictEqual(
      JSON.stringify(copy.toJSON()),
      JSON.stringify(nes.toJSON()),
    );
  });

  it("importFastStateSnapshot restores arbitrary saved checkpoint", function () {
    let nes = new NES();
    nes.loadROM(romData());
    nes.frame();
    nes.frame();
    const checkpoint = nes.exportFastStateSnapshot();
    nes.frame();
    assert.notStrictEqual(JSON.stringify(nes.toJSON()), JSON.stringify({}));
    nes.importFastStateSnapshot(checkpoint);
    let restored = new NES();
    restored.loadROM(romData());
    restored.frame();
    restored.frame();
    assert.strictEqual(
      JSON.stringify(nes.toJSON()),
      JSON.stringify(restored.toJSON()),
    );
  });
});
