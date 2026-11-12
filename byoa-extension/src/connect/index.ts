import type { SiteShare } from '../lib/site-grant';
import type { ProfileList } from '../../sdk';
const shareSection = document.querySelector<HTMLFieldSetElement>('#sharing');
const shareInputs = Object.fromEntries(
  ['persona', 'user', 'memory'].map((key) => [
    key,
    document.querySelector<HTMLInputElement>(`#share-${key}`),
  ])
);
let updateSharing = () => {};
const id = window.location.hash.slice(1);
const form = document.querySelector<HTMLFormElement>('#connect-form');
const list = document.querySelector<HTMLFieldSetElement>('#profiles');
const approve = document.querySelector<HTMLButtonElement>('#approve');
const errorBox = document.querySelector<HTMLElement>('#error');
function error(message: string) {
  if (errorBox) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
}
async function send(type: string, agentId?: string) {
  const result = await chrome.runtime.sendMessage({
    type,
    requestId: id,
    agentId,
    ...(type === 'CONNECTION_PROMPT_APPROVE'
      ? {
          persist: document.querySelector<HTMLSelectElement>('#persist')?.value ?? 'session',
          share: Object.fromEntries(
            Object.entries(shareInputs).map(([key, input]) => [
              key,
              !shareSection?.hidden && input?.checked === true,
            ])
          ),
        }
      : {}),
  });
  if (result?.success === false) throw new Error(result.error || 'Could not connect.');
  return result;
}
/** The host the person will recognize, from the verified origin (never a site-supplied name). */
function siteName(origin: string) {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}
let busy = false;
function selection() {
  return document.querySelector<HTMLInputElement>('input[name="profile"]:checked')?.value;
}
async function load() {
  try {
    const result = (await send('CONNECTION_PROMPT_GET')) as Omit<ProfileList, 'profiles'> & {
      origin: string;
      selectedAgentId?: string;
      share?: SiteShare;
      persist: string;
      incognito: boolean;
      profiles: Array<ProfileList['profiles'][number] & { hasWorkspace: boolean }>;
    };
    const duration = document.querySelector<HTMLElement>('#duration');
    if (duration) duration.hidden = result.incognito;
    const persist = document.querySelector<HTMLSelectElement>('#persist');
    if (persist) persist.value = result.incognito ? 'session' : result.persist;
    const origin = document.querySelector('#origin');
    if (origin) origin.textContent = result.origin;
    const title = document.querySelector('#title');
    if (title) title.textContent = `Connect your agent to ${siteName(result.origin)}?`;
    if (!list) return;
    list.querySelectorAll('label,p').forEach((element) => element.remove());
    const selected =
      result.selectedAgentId ||
      result.defaultAgentId ||
      result.profiles.find((profile) => profile.ready)?.id;
    for (const profile of result.profiles) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'profile';
      input.value = profile.id;
      input.disabled = !profile.ready;
      input.checked = profile.id === selected && profile.ready;
      const text = document.createElement('span');
      text.textContent = profile.name;
      if (!profile.ready) {
        const note = document.createElement('small');
        note.textContent = 'Needs setup';
        text.append(note);
      }
      label.append(input, text);
      list.append(label);
    }
    if (!result.profiles.length) {
      const text = document.createElement('p');
      text.textContent = 'No profiles yet. Add an API profile in BYOA settings, then return here.';
      list.append(text);
    }
    updateSharing = () => {
      const selectedProfile = result.profiles.find((profile) => profile.id === selection());
      if (shareSection) shareSection.hidden = !selectedProfile?.hasWorkspace;
      for (const [key, input] of Object.entries(shareInputs)) {
        if (!input) continue;
        input.checked =
          selectedProfile?.id === result.selectedAgentId &&
          result.share?.[key as keyof SiteShare] === true;
      }
    };
    updateSharing();
    if (approve) approve.disabled = !selection();
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
  }
}
form?.addEventListener('change', (event) => {
  if ((event.target as HTMLInputElement).name === 'profile') updateSharing();
  if (approve) approve.disabled = busy || !selection();
});
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy || !selection()) return;
  busy = true;
  if (approve) approve.disabled = true;
  void send('CONNECTION_PROMPT_APPROVE', selection())
    .then(() => window.close())
    .catch((cause) => {
      error(cause instanceof Error ? cause.message : String(cause));
      busy = false;
      if (approve) approve.disabled = !selection();
    });
});
document.querySelector('#cancel')?.addEventListener('click', () => {
  if (busy) return;
  busy = true;
  void send('CONNECTION_PROMPT_REJECT')
    .then(() => window.close())
    .catch(() => window.close());
});
document.querySelector('#settings')?.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.config && !busy) void load();
});
void load();
