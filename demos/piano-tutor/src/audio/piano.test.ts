import { describe, expect, it } from 'vitest';
import { pianoPartials } from './piano';

describe('pianoPartials', () => {
  it('normalises levels and starts at the fundamental', () => {
    const partials = pianoPartials(261.63);
    expect(partials[0].freq).toBeCloseTo(261.63, 0);
    expect(partials.reduce((sum, p) => sum + p.amp, 0)).toBeCloseTo(1, 6);
  });

  it('stretches upper partials sharp, like a stiff string', () => {
    const partials = pianoPartials(440);
    partials.forEach((p, i) => expect(p.freq).toBeGreaterThanOrEqual(440 * (i + 1)));
    expect(partials[5].freq).toBeGreaterThan(440 * 6 + 0.5);
  });

  it('decays higher partials faster, and low notes ring longer than high ones', () => {
    const middle = pianoPartials(261.63);
    for (let i = 1; i < middle.length; i++) expect(middle[i].decay).toBeLessThan(middle[i - 1].decay);
    expect(pianoPartials(65.41)[0].decay).toBeGreaterThan(middle[0].decay);
    expect(pianoPartials(2093)[0].decay).toBeLessThan(middle[0].decay);
  });

  it('nearly drops the partial the hammer position cancels', () => {
    const partials = pianoPartials(130.81);
    expect(partials[7].amp).toBeLessThan(partials[6].amp * 0.5);
    expect(partials[7].amp).toBeLessThan(partials[8].amp);
  });

  it('keeps every partial below 12 kHz', () => {
    expect(pianoPartials(3000).every((p) => p.freq <= 12000)).toBe(true);
  });
});
