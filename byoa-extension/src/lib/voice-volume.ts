/** Only a smoothed volume scalar leaves this sampler. No recording or speaker connection. */
export function sampleVoiceVolume(update: (level: number) => void, unavailable: () => void) {
  let closed = false;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    closed = true;
    clearInterval(timer);
    source?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  };
  void (async () => {
    try {
      const acquired = await globalThis.navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (closed) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;
      context = new AudioContext();
      void context.resume().catch(() => {});
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let level = 0;
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        const energy = data.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0);
        const target = Math.min(0.75, Math.max(0, Math.sqrt(energy / data.length) - 0.008) * 2);
        level += (target - level) * (1 - Math.exp(-42 / (target > level ? 180 : 360)));
        update(level);
      }, 42);
    } catch {
      if (!closed) {
        stop();
        unavailable();
      }
    }
  })();
  return stop;
}
