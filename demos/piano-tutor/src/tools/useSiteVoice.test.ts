import { enableSiteVoice, SITE_VOICE_INSTRUCTIONS } from './useSiteVoice';

describe('enableSiteVoice', () => {
  it('offers the registered tools and turns voice off on cleanup', async () => {
    const calls: unknown[] = [];
    const client = { configureVoice: async (options: unknown) => void calls.push(options) };
    const cleanup = enableSiteVoice(client, ['show_chord', 'get_state']);
    expect(calls).toEqual([{ enabled: true, tools: ['show_chord', 'get_state'], instructions: SITE_VOICE_INSTRUCTIONS }]);
    cleanup();
    expect(calls.at(-1)).toEqual({ enabled: false });
  });

  it('ignores a missing extension', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const client = { configureVoice: () => Promise.reject(new Error('No agent provider found.')) };
    enableSiteVoice(client, ['show_chord'])();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
