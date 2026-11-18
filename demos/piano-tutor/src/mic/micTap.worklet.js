// Copies microphone samples to the page in 1536-sample blocks (32 ms at 48 kHz). Runs on the
// audio thread, so it keeps going when the tab is in the background, unlike requestAnimationFrame.
class PianoTutorTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(1536);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i += 1) {
        this.block[this.filled++] = channel[i];
        if (this.filled === this.block.length) {
          this.port.postMessage(this.block.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('piano-tutor-tap', PianoTutorTap);
