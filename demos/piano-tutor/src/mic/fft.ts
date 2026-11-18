/** In-place iterative radix-2 FFT. `re` and `im` have power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Blackman-windowed magnitude spectrum of the `size` samples ending at `end`, like an AnalyserNode. */
export function magnitudeSpectrum(samples: Float32Array, end: number, size: number): Float32Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const start = end - size;
  for (let i = 0; i < size; i += 1) {
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (size - 1));
    re[i] = (start + i >= 0 ? samples[start + i] : 0) * w;
  }
  fft(re, im);
  const out = new Float32Array(size / 2);
  for (let i = 0; i < size / 2; i += 1) out[i] = Math.hypot(re[i], im[i]) / size;
  return out;
}

export function rms(samples: Float32Array, end: number, size: number): number {
  let sum = 0;
  for (let i = Math.max(0, end - size); i < end; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / size);
}
