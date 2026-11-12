/** Bar geometry in CSS pixels: narrow rounded bars with small, even gaps. */
const BAR_WIDTH = 3;
const BAR_GAP = 2;
/** How often a finished bar scrolls left and a new one starts. */
const BAR_INTERVAL_MS = 100;
/** Loudest smoothed level we draw as a full-height bar. */
const MAX_LEVEL = 0.75;
/** Enough history for a very wide sidebar; only the bars that fit are drawn. */
const HISTORY = 512;

/** Visualize live local microphone samples. Never record, persist, or connect to speakers. */
export function startVoiceMeter(canvas: HTMLCanvasElement, unavailable: () => void): () => void {
  let closed = false;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let frame: number | undefined;
  const stop = () => {
    if (closed) return;
    closed = true;
    if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
    source?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  };
  try {
    context = new globalThis.AudioContext();
    const audioContext = context;
    void audioContext.resume().catch(() => {});
    void globalThis.navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((media) => {
        if (closed) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const draw = canvas.getContext('2d');
        if (!draw) throw new Error('Canvas unavailable');
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        source = audioContext.createMediaStreamSource(media);
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        // Show recent volume, not the rapidly changing phase of raw audio samples.
        // A slower release keeps pauses gentle; a small noise floor ignores room hiss.
        // The newest bar (last slot) follows the live level; older bars stay fixed.
        const levels = new Float32Array(HISTORY);
        let level = 0;
        let lastPaint = -Infinity;
        let lastBar = -Infinity;
        // Match the canvas backing store to its laid-out size so bars stay crisp.
        let width = canvas.width;
        let height = canvas.height;
        const fit = () => {
          const ratio = globalThis.devicePixelRatio || 1;
          const cssWidth = canvas.clientWidth;
          const cssHeight = canvas.clientHeight;
          if (!cssWidth || !cssHeight) return;
          const pixelWidth = Math.round(cssWidth * ratio);
          const pixelHeight = Math.round(cssHeight * ratio);
          if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
          }
          width = cssWidth;
          height = cssHeight;
          draw.setTransform(ratio, 0, 0, ratio, 0, 0);
        };
        const paint = (now = 0) => {
          if (closed) return;
          if (now - lastPaint >= 1000 / 24) {
            const elapsed = Number.isFinite(lastPaint) ? Math.min(now - lastPaint, 100) : 1000 / 24;
            lastPaint = now;
            analyser.getByteTimeDomainData(samples);
            let energy = 0;
            for (const sample of samples) energy += ((sample - 128) / 128) ** 2;
            const target = Math.min(
              MAX_LEVEL,
              Math.max(0, Math.sqrt(energy / samples.length) - 0.008) * 2
            );
            const smoothing = 1 - Math.exp(-elapsed / (target > level ? 180 : 360));
            level += (target - level) * smoothing;
            if (now - lastBar >= BAR_INTERVAL_MS) {
              lastBar = now;
              levels.copyWithin(0, 1);
            }
            levels[HISTORY - 1] = level;

            fit();
            draw.clearRect(0, 0, width, height);
            draw.strokeStyle = globalThis.getComputedStyle(canvas).color;
            draw.lineWidth = BAR_WIDTH;
            draw.lineCap = 'round';
            // As many bars as fit, centered, newest on the right. Silence draws as dots:
            // a tiny stroke with round caps is a BAR_WIDTH circle (zero-length ones are pruned).
            const pitch = BAR_WIDTH + BAR_GAP;
            const count = Math.max(1, Math.min(HISTORY, Math.floor((width + BAR_GAP) / pitch)));
            const left = (width - (count * pitch - BAR_GAP)) / 2 + BAR_WIDTH / 2;
            const middle = height / 2;
            const reach = Math.max(0, height - BAR_WIDTH - 4) / 2;
            draw.beginPath();
            for (let i = 0; i < count; i++) {
              const half = Math.max(0.25, (levels[HISTORY - count + i] / MAX_LEVEL) * reach);
              const x = left + i * pitch;
              draw.moveTo(x, middle - half);
              draw.lineTo(x, middle + half);
            }
            draw.stroke();
          }
          frame = globalThis.requestAnimationFrame(paint);
        };
        paint();
      })
      .catch(() => {
        if (!closed) {
          stop();
          unavailable();
        }
      });
  } catch {
    stop();
    unavailable();
  }
  return stop;
}
