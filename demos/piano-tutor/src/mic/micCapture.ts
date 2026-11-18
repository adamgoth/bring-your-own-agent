// Microphone capture with raw-audio constraints (no echo cancellation, noise suppression or
// auto gain). It hands out magnitude spectra for chord detection instead of running a pitch detector. Samples come
// from an AudioWorklet (not throttled in background tabs) and the spectrum is computed with the
// same FFT and Blackman window as the synthetic-audio tests in mic.test.ts.

import tapUrl from './micTap.worklet.js?url';
import { magnitudeSpectrum, rms } from './fft';

export type AudioInputOption = { deviceId: string; label: string };
export type MicFrame = { t: number; rms: number; magnitudes: Float32Array; sampleRate: number; fftSize: number };
export type MicSession = { devices: AudioInputOption[]; deviceId?: string; label: string; sampleRate: number };
export type MicCapture = {
  start(onFrame: (frame: MicFrame) => void, deviceId?: string): Promise<MicSession>;
  stop(): Promise<void>;
};

export const FFT_SIZE = 8192;
const RMS_SIZE = 1024;

const BUILT_IN_MICROPHONE_PATTERN = /\b(built[- ]?in|internal|macbook|imac|studio display)\b/i;
const VIRTUAL_AUDIO_PATTERN = /\b(blackhole|loopback|soundflower|virtual|aggregate|multi-output)\b/i;

/** The requested device, else a built-in mic, else a real (non-virtual) input. */
export function choosePreferredMicrophone(devices: readonly AudioInputOption[], requestedDeviceId?: string): AudioInputOption | undefined {
  const requested = requestedDeviceId ? devices.find((d) => d.deviceId === requestedDeviceId) : undefined;
  return (
    requested ??
    devices.find((d) => BUILT_IN_MICROPHONE_PATTERN.test(d.label)) ??
    devices.find((d) => d.deviceId !== 'default' && !VIRTUAL_AUDIO_PATTERN.test(d.label)) ??
    devices.find((d) => d.deviceId === 'default') ??
    devices[0]
  );
}

export class BrowserMicCapture implements MicCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private tap: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;

  private async inputs(): Promise<AudioInputOption[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
  }

  async start(onFrame: (frame: MicFrame) => void, deviceId?: string): Promise<MicSession> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone input needs a secure page (localhost or HTTPS) in a supported browser.');
    }
    await this.stop();
    let devices = await this.inputs();
    if (devices.length === 0 || devices.every((d) => !d.label)) {
      const permission = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      permission.getTracks().forEach((track) => track.stop());
      devices = await this.inputs();
    }
    const chosen = choosePreferredMicrophone(devices, deviceId);
    const audio: MediaTrackConstraints = { autoGainControl: false, channelCount: 1, echoCancellation: false, noiseSuppression: false };
    if (chosen?.deviceId) audio.deviceId = { exact: chosen.deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });

    this.context = new AudioContext({ latencyHint: 'interactive' });
    await this.context.resume();
    await this.context.audioWorklet.addModule(tapUrl);
    this.source = this.context.createMediaStreamSource(this.stream);
    this.tap = new AudioWorkletNode(this.context, 'piano-tutor-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    // A silent path to the speakers keeps the graph pulling samples through the tap.
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.tap).connect(this.sink).connect(this.context.destination);

    const sampleRate = this.context.sampleRate;
    const ring = new Float32Array(FFT_SIZE);
    this.tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const block = event.data;
      ring.copyWithin(0, block.length);
      ring.set(block, FFT_SIZE - block.length);
      onFrame({
        t: performance.now(),
        rms: rms(ring, FFT_SIZE, RMS_SIZE),
        magnitudes: magnitudeSpectrum(ring, FFT_SIZE, FFT_SIZE),
        sampleRate,
        fftSize: FFT_SIZE,
      });
    };

    const track = this.stream.getAudioTracks()[0];
    return { devices, deviceId: track?.getSettings().deviceId ?? chosen?.deviceId, label: track?.label || chosen?.label || 'Microphone', sampleRate };
  }

  async stop(): Promise<void> {
    if (this.tap) this.tap.port.onmessage = null;
    this.tap?.disconnect();
    this.tap = null;
    this.sink?.disconnect();
    this.sink = null;
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
  }
}
