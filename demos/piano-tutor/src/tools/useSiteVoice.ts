import { useEffect } from 'react';
import { useAgentSession, useConnection } from '@byoagent/react';

export const SITE_VOICE_INSTRUCTIONS =
  'You are helping someone learn piano in Piano Tutor. Use the tools to show chords and keys on the ' +
  'keyboard. Tool results already describe what is on screen; call get_state only when unsure. The app has three modes: chord and key show ' +
  'what was chosen, and listen follows what the person plays. Showing a chord or key ends listen mode; after that, ' +
  'get_listening_summary still knows what they played. ' +
  'To play a progression or several chords, call play_progression once instead of selecting and playing each chord. Keep replies short enough to read at the piano.';

type VoiceClient = {
  configureVoice(options: { enabled: boolean; tools?: readonly string[]; instructions?: string }): Promise<void>;
};

/**
 * Ask BYOA for its floating voice mic, limited to `tools`. Returns the cleanup that turns it off.
 * BYOA refuses tools the page hasn't registered, so call this only after registration finishes.
 */
export function enableSiteVoice(client: VoiceClient, tools: readonly string[]): () => void {
  // No BYOA extension, or one without voice: the page works the same without the mic.
  void client.configureVoice({ enabled: true, tools, instructions: SITE_VOICE_INSTRUCTIONS }).catch(() => {});
  return () => void client.configureVoice({ enabled: false }).catch(() => {});
}

/** Offer BYOA's floating voice once `ready` (tools registered) and again whenever the site connects. */
export function useSiteVoice(tools: readonly string[], ready: boolean) {
  const { client } = useAgentSession();
  const { connection } = useConnection();
  const key = tools.join(',');
  useEffect(() => {
    if (!ready || !connection.connected) return;
    return enableSiteVoice(client, key.split(','));
  }, [client, key, ready, connection.connected]);
}
