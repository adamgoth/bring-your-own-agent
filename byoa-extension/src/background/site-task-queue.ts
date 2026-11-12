/** Limits provider load while allowing independent apps to make progress. */
export const SITE_TASK_LIMIT = 3;
export const SITE_TASK_PROFILE_LIMIT = 2;

export class SiteTaskQueue {
  private active = 0;
  private profiles = new Map<string, number>();
  private waiting: Array<{ agentId: string; enter: () => void }> = [];

  acquire(signal: AbortSignal, agentId: string): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const waiter = { agentId, enter: () => {} };
      const abort = () => {
        this.waiting = this.waiting.filter((entry) => entry !== waiter);
        reject(new Error('Task cancelled while queued.'));
        this.next();
      };
      waiter.enter = () => {
        signal.removeEventListener('abort', abort);
        this.active++;
        this.profiles.set(agentId, (this.profiles.get(agentId) ?? 0) + 1);
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          const count = (this.profiles.get(agentId) ?? 1) - 1;
          if (count) this.profiles.set(agentId, count);
          else this.profiles.delete(agentId);
          this.next();
        });
      };
      if (signal.aborted) {
        reject(new Error('Task cancelled while queued.'));
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
      this.waiting.push(waiter);
      this.next();
    });
  }

  private next(): void {
    while (this.active < SITE_TASK_LIMIT) {
      const index = this.waiting.findIndex(
        ({ agentId }) => (this.profiles.get(agentId) ?? 0) < SITE_TASK_PROFILE_LIMIT
      );
      if (index < 0) return;
      this.waiting.splice(index, 1)[0].enter();
    }
  }
}
