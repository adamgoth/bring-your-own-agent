import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { callout, settingRow, toggleRow } from '../src/options/ui';

describe('options UI helpers', () => {
  it('toggleRow renders a labelled switch that reports changes', () => {
    const onChange = vi.fn();
    const row = toggleRow({
      id: 'voice-mode',
      title: 'Voice mode',
      badge: 'Beta',
      hint: 'Show the floating voice pane.',
      onChange,
    });
    document.body.replaceChildren(row);

    const input = document.getElementById('voice-mode') as HTMLInputElement;
    expect(input.type).toBe('checkbox');
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.className).toBe('ui-switch');
    expect(input.checked).toBe(false);
    expect(row.querySelector('label[for="voice-mode"]')?.textContent).toBe('Voice modeBeta');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Show the floating voice pane.'
    );

    (row.querySelector('label') as HTMLLabelElement).click();
    expect(input.checked).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('settingRow can label its control and expose its hint id', () => {
    const select = document.createElement('select');
    select.id = 'level';
    const row = settingRow({
      title: 'Level',
      hint: 'How much to log.',
      control: select,
      labelFor: 'level',
      hintId: 'level-hint',
    });
    expect(row.querySelector('label.ui-setting-title')?.getAttribute('for')).toBe('level');
    expect(row.querySelector('#level-hint')?.textContent).toBe('How much to log.');
    expect(settingRow({ title: 'Plain', control: select }).querySelector('h4')?.textContent).toBe(
      'Plain'
    );
  });

  it('callout carries its tone and optional lines', () => {
    const note = callout({ title: 'Careful', body: 'Body', meta: 'Aside' });
    expect(note.dataset.tone).toBe('warning');
    expect([...note.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Careful',
      'Body',
      'Aside',
    ]);
    expect(callout({ title: 'Only', tone: 'neutral' }).querySelectorAll('p')).toHaveLength(1);
  });
});

describe('general settings markup', () => {
  const doc = new DOMParser().parseFromString(
    readFileSync('src/options/index.html', 'utf8'),
    'text/html'
  );

  it('keeps the ids that index.ts and backup-restore.ts read', () => {
    for (const id of [
      'site-task-timeout',
      'log-level',
      'app-spending-limits',
      'export-settings',
      'import-settings',
      'import-file-input',
      'status-message',
    ])
      expect(doc.getElementById(id), id).not.toBeNull();
    expect(doc.querySelector('label[for="site-task-timeout"]')).not.toBeNull();
    expect(doc.querySelector('label[for="log-level"]')).not.toBeNull();
    expect((doc.getElementById('log-level') as HTMLSelectElement).value).toBe('warn');
  });

  it('shows voice mode as a labelled switch', () => {
    const voice = doc.getElementById('voice-mode') as HTMLInputElement;
    expect(voice.type).toBe('checkbox');
    expect(voice.classList.contains('ui-switch')).toBe(true);
    expect(voice.closest('.form-group')).toBeNull();
    expect(doc.querySelector('label[for="voice-mode"]')?.textContent).toMatch(/Voice mode/);
  });

  it('uses no emoji in the backup buttons', () => {
    for (const id of ['export-settings', 'import-settings'])
      expect(doc.getElementById(id)?.textContent?.trim()).toMatch(/^[A-Za-z ]+$/);
  });
});
