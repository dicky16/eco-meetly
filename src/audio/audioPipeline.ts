/**
 * Dual-path Web Audio capture + pre-roll VAD pipeline for Electron Renderer.
 * - Path A: Streams 48 kHz mono Float32 chunks to Main Process RecordingSaver.
 * - Path B: Segments speech with a 340ms pre-roll buffer, normalizes quiet speech,
 *   resamples accurately to 16 kHz, and emits speech chunks for local Whisper STT.
 */
export class AudioCapturePipeline {
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private systemStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;

  private preRollBuffer: Float32Array[] = [];
  private speechBuffer: Float32Array[] = [];
  private speechSamples = 0;
  private isSpeaking = false;
  private isPaused = false;
  private silenceFrames = 0;
  private segmentStartMs = 0;
  private recordingStartTime = 0;
  private actualSampleRate = 48000;

  private readonly targetCaptureRate = 48000;
  private readonly preRollFrames = 4; // ~340 ms at 4096 samples / 48 kHz
  private readonly vadThreshold = 0.007;
  private readonly maxSilenceFrames = 12; // ~1.0 s pause before flushing
  private readonly softSegmentSeconds = 12;
  private readonly hardSegmentSeconds = 20;

  async start(options: {
    includeSystemAudio: boolean;
    micDeviceId?: string;
    onLevel: (level: number) => void;
    onChunk48k: (chunk: Float32Array) => void;
    onSpeechSegment16k: (segment16k: Float32Array, startTimeMs: number, endTimeMs: number) => void;
  }): Promise<void> {
    this.audioCtx = new AudioContext({ sampleRate: this.targetCaptureRate });
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    this.actualSampleRate = this.audioCtx.sampleRate;

    const mixer = this.audioCtx.createGain();
    mixer.gain.value = 1.0;

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.micDeviceId && options.micDeviceId !== 'default' ? { exact: options.micDeviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const micSource = this.audioCtx.createMediaStreamSource(this.micStream);
    micSource.connect(mixer);

    if (options.includeSystemAudio) {
      try {
        const displayPromise = navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('System audio capture timed out')), 4000)
        );
        this.systemStream = await Promise.race([displayPromise, timeoutPromise]);
        this.systemStream.getVideoTracks().forEach((t) => t.stop());

        const audioTracks = this.systemStream.getAudioTracks();
        if (audioTracks.length > 0) {
          const sysAudioOnly = new MediaStream(audioTracks);
          const sysSource = this.audioCtx.createMediaStreamSource(sysAudioOnly);
          sysSource.connect(mixer);
        }
      } catch (err) {
        console.warn('[AudioCapturePipeline] System audio capture unavailable, continuing with mic only:', err);
      }
    }

    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    const muteOut = this.audioCtx.createGain();
    muteOut.gain.value = 0;

    this.recordingStartTime = Date.now();
    this.preRollBuffer = [];
    this.speechBuffer = [];
    this.speechSamples = 0;
    this.isSpeaking = false;
    this.silenceFrames = 0;

    const softLimitSamples = this.actualSampleRate * this.softSegmentSeconds;
    const hardLimitSamples = this.actualSampleRate * this.hardSegmentSeconds;

    this.processor.onaudioprocess = (event) => {
      if (this.isPaused) {
        options.onLevel(0);
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);

      // Path A: full mixed audio to RecordingSaver
      options.onChunk48k(copy);

      // Compute RMS for UI meter & VAD
      let sumSq = 0;
      for (let i = 0; i < copy.length; i++) {
        sumSq += copy[i] * copy[i];
      }
      const rms = Math.sqrt(sumSq / copy.length);
      options.onLevel(Math.min(1, rms * 9));

      const nowMs = Date.now() - this.recordingStartTime;
      const isVoice = rms >= this.vadThreshold;

      if (isVoice) {
        if (!this.isSpeaking) {
          this.isSpeaking = true;
          const preRollMs = Math.round((this.preRollBuffer.length * copy.length * 1000) / this.actualSampleRate);
          this.segmentStartMs = Math.max(0, nowMs - preRollMs);
          // Prepend pre-roll frames so initial consonants/syllables are never clipped
          for (const frame of this.preRollBuffer) {
            this.speechBuffer.push(frame);
            this.speechSamples += frame.length;
          }
          this.preRollBuffer = [];
        }
        this.silenceFrames = 0;
        this.speechBuffer.push(copy);
        this.speechSamples += copy.length;

        if (this.speechSamples >= hardLimitSamples) {
          this.flushSpeech(nowMs, options.onSpeechSegment16k);
        }
      } else if (this.isSpeaking) {
        this.silenceFrames++;
        this.speechBuffer.push(copy);
        this.speechSamples += copy.length;

        // Flush on natural pause, or on brief dip after softLimitSamples
        if (
          this.silenceFrames >= this.maxSilenceFrames ||
          (this.speechSamples >= softLimitSamples && this.silenceFrames >= 2)
        ) {
          this.flushSpeech(nowMs, options.onSpeechSegment16k);
        }
      } else {
        // Maintain rolling pre-roll buffer while idle
        this.preRollBuffer.push(copy);
        if (this.preRollBuffer.length > this.preRollFrames) {
          this.preRollBuffer.shift();
        }
      }
    };

    mixer.connect(this.processor);
    this.processor.connect(muteOut);
    muteOut.connect(this.audioCtx.destination);
  }

  private flushSpeech(
    endMs: number,
    onSpeechSegment16k: (segment16k: Float32Array, startTimeMs: number, endTimeMs: number) => void
  ): void {
    if (this.speechSamples === 0) return;

    const merged = new Float32Array(this.speechSamples);
    let offset = 0;
    for (const chunk of this.speechBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    this.speechBuffer = [];
    this.speechSamples = 0;
    this.isSpeaking = false;
    this.silenceFrames = 0;

    const resampled16k = resampleTo16k(merged, this.actualSampleRate);
    if (resampled16k.length >= 4000) {
      const prepared = prepareSpeechForWhisper(resampled16k);
      onSpeechSegment16k(prepared, this.segmentStartMs, endMs);
    }
  }

  pause(
    onSpeechSegment16k?: (segment16k: Float32Array, startTimeMs: number, endTimeMs: number) => void
  ): void {
    this.isPaused = true;
    if (onSpeechSegment16k && this.speechSamples > 0) {
      this.flushSpeech(Date.now() - this.recordingStartTime, onSpeechSegment16k);
    }
  }

  resume(): void {
    this.isPaused = false;
  }

  async stop(
    onSpeechSegment16k?: (segment16k: Float32Array, startTimeMs: number, endTimeMs: number) => void
  ): Promise<void> {
    if (onSpeechSegment16k && this.speechSamples > 0) {
      this.flushSpeech(Date.now() - this.recordingStartTime, onSpeechSegment16k);
    }
    this.processor?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.systemStream?.getTracks().forEach((t) => t.stop());
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      await this.audioCtx.close();
    }
    this.processor = null;
    this.micStream = null;
    this.systemStream = null;
    this.audioCtx = null;
  }
}

export function downsample48kTo16k(input: Float32Array): Float32Array {
  return resampleTo16k(input, 48000);
}

/**
 * Resamples mono Float32 audio from `inputSampleRate` (e.g., 48000 or 44100) to 16000 Hz.
 */
export function resampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) return input;
  if (inputSampleRate === 48000) {
    const outLen = Math.floor(input.length / 3);
    const output = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = i * 3;
      output[i] = (input[idx] + input[idx + 1] + input[idx + 2]) / 3;
    }
    return output;
  }

  const ratio = inputSampleRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const output = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIdx - i0;
    output[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return output;
}

/**
 * Removes DC offset, gently normalizes quiet speech up to 4x gain (peak ~0.7),
 * and adds 150ms silence padding at start/end so Whisper doesn't clip edge phonemes.
 */
export function prepareSpeechForWhisper(samples16k: Float32Array): Float32Array {
  if (samples16k.length === 0) return samples16k;

  let mean = 0;
  for (let i = 0; i < samples16k.length; i++) {
    mean += samples16k[i];
  }
  mean /= samples16k.length;

  let peak = 0;
  for (let i = 0; i < samples16k.length; i++) {
    const abs = Math.abs(samples16k[i] - mean);
    if (abs > peak) peak = abs;
  }

  const gain = peak > 0.005 && peak < 0.7 ? Math.min(4.0, 0.7 / peak) : 1.0;
  const padSamples = 2400; // 150ms at 16 kHz
  const out = new Float32Array(samples16k.length + padSamples * 2);

  for (let i = 0; i < samples16k.length; i++) {
    const val = (samples16k[i] - mean) * gain;
    out[padSamples + i] = Math.max(-1, Math.min(1, val));
  }
  return out;
}
