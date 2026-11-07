/** Serialize page tasks because the existing model client has one active stream. */
export class SiteTaskQueue {
  private active = false;
  private waiting: Array<() => void> = [];
  acquire(signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      let admitted = false;
      const abort = () => {
        if (admitted) return;
        this.waiting = this.waiting.filter((entry) => entry !== enter);
        reject(new Error('Task cancelled while queued.'));
      };
      const enter = () => {
        if (signal.aborted) {
          abort();
          this.next();
          return;
        }
        admitted = true;
        this.active = true;
        signal.removeEventListener('abort', abort);
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active = false;
          this.next();
        });
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
      if (this.active) this.waiting.push(enter);
      else enter();
    });
  }
  private next() {
    if (!this.active) this.waiting.shift()?.();
  }
}
