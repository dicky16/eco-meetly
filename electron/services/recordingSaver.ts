import fs from 'node:fs';
import path from 'node:path';

/**
 * Incrementally writes 48 kHz mono 16-bit PCM audio chunks to a standard WAV file.
 * Keeps audio safe on disk during long meetings and finalizes the RIFF header on stop.
 */
export class RecordingSaver {
  private fd: number | null = null;
  private filePath: string | null = null;
  private dataBytes = 0;
  private readonly sampleRate = 48000;
  private readonly numChannels = 1;
  private readonly bitsPerSample = 16;

  start(folderPath: string, filename = 'recording.wav'): string {
    fs.mkdirSync(folderPath, { recursive: true });
    this.filePath = path.join(folderPath, filename);
    this.fd = fs.openSync(this.filePath, 'w');
    this.dataBytes = 0;

    // Write placeholder 44-byte WAV header
    const header = this.buildWavHeader(0);
    fs.writeSync(this.fd, header, 0, header.length, 0);
    return this.filePath;
  }

  appendFloat32Chunk(samples: Float32Array): void {
    if (this.fd === null || samples.length === 0) return;

    const pcmBuffer = Buffer.allocUnsafe(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      pcmBuffer.writeInt16LE(Math.round(int16), i * 2);
    }

    fs.writeSync(this.fd, pcmBuffer, 0, pcmBuffer.length, 44 + this.dataBytes);
    this.dataBytes += pcmBuffer.length;
  }

  stop(): string | null {
    if (this.fd === null) return null;
    try {
      const header = this.buildWavHeader(this.dataBytes);
      fs.writeSync(this.fd, header, 0, header.length, 0);
      fs.closeSync(this.fd);
    } finally {
      this.fd = null;
    }
    return this.filePath;
  }

  private buildWavHeader(dataSize: number): Buffer {
    const buffer = Buffer.alloc(44);
    const byteRate = (this.sampleRate * this.numChannels * this.bitsPerSample) / 8;
    const blockAlign = (this.numChannels * this.bitsPerSample) / 8;

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // PCM chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(this.numChannels, 22);
    buffer.writeUInt32LE(this.sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(this.bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    return buffer;
  }
}
