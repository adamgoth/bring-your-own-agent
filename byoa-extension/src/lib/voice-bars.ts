/** Smoothed vertical-bar history shared by sidebar and floating control. Levels are already smoothed. */
export function createVoiceBars(canvas: HTMLCanvasElement) {
  const draw = canvas.getContext('2d');
  if (!draw) throw new Error('Canvas unavailable');
  const history = new Float32Array(512);
  let lastBar = -Infinity;
  return (level: number, now = globalThis.performance.now()) => {
    const ratio = globalThis.devicePixelRatio || 1;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (canvas.clientWidth && canvas.clientHeight) {
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      draw.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    if (now - lastBar >= 100) {
      lastBar = now;
      history.copyWithin(0, 1);
    }
    history[511] = Math.max(0, Math.min(0.75, level));
    draw.clearRect(0, 0, width, height);
    draw.strokeStyle = globalThis.getComputedStyle(canvas).color;
    draw.lineWidth = 3;
    draw.lineCap = 'round';
    const count = Math.max(1, Math.min(512, Math.floor((width + 2) / 5)));
    const left = (width - (count * 5 - 2)) / 2 + 1.5;
    const reach = Math.max(0, height - 7) / 2;
    draw.beginPath();
    for (let i = 0; i < count; i++) {
      const half = Math.max(0.25, (history[512 - count + i] / 0.75) * reach);
      draw.moveTo(left + i * 5, height / 2 - half);
      draw.lineTo(left + i * 5, height / 2 + half);
    }
    draw.stroke();
  };
}
