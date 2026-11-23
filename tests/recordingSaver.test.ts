import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecordingSaver } from '../electron/services/recordingSaver';

describe('RecordingSaver', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-meetly-wav-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a valid 48 kHz mono 16-bit WAV file with accurate header sizes', () => {
    const saver = new RecordingSaver();
    const outPath = saver.start(tmpDir, 'test.wav');

    // 4 samples: -1.5 (clamped to -1), 0, 0.5, 2.0 (clamped to 1)
    saver.appendFloat32Chunk(new Float32Array([-1.5, 0, 0.5, 2.0]));
    const finalized = saver.stop();

    expect(finalized).toBe(outPath);
    const buf = fs.readFileSync(outPath);

    // 44-byte header + 4 samples * 2 bytes = 52 bytes
    expect(buf.length).toBe(52);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.readUInt32LE(4)).toBe(36 + 8);
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buf.readUInt16LE(22)).toBe(1); // mono
    expect(buf.readUInt32LE(24)).toBe(48000); // 48 kHz
    expect(buf.readUInt16LE(34)).toBe(16); // 16-bit
    expect(buf.toString('ascii', 36, 40)).toBe('data');
    expect(buf.readUInt32LE(40)).toBe(8);

    // Sample values
    expect(buf.readInt16LE(44)).toBe(-32768);
    expect(buf.readInt16LE(46)).toBe(0);
    expect(buf.readInt16LE(50)).toBe(32767);
  });
});
