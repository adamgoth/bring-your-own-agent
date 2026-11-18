import { useEffect, useState } from 'react';
import { AgentConnection } from './AgentConnection';
import { SettingsMenu } from './SettingsMenu';

type Theme = 'light' | 'dark';

function initialTheme(): Theme | null {
  try {
    const saved = localStorage.getItem('piano-tutor-theme');
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null;
  }
}

export function Header() {
  const [theme, setTheme] = useState<Theme | null>(initialTheme);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const toggle = () => {
    const current = theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('piano-tutor-theme', next);
    } catch {
      /* per-viewer convenience only */
    }
  };

  return (
    <header className="header">
      <h1 className="header__title">Piano Tutor</h1>
      <div className="header__tools">
        <AgentConnection />
        <SettingsMenu />
        <button type="button" className="theme" onClick={toggle} aria-label="Switch light or dark theme">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2a8 8 0 1 0 0 16z" /><circle cx="10" cy="10" r="7.25" fill="none" strokeWidth="1.5" /></svg>
        </button>
      </div>
    </header>
  );
}
