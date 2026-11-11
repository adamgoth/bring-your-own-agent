import { describe, expect, it } from 'vitest';
import { isTrustedSubmitShortcut } from '../src/content-scripts/site-gesture';

const commandEnter = {
  isTrusted: true,
  key: 'Enter',
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
};
describe('site task keyboard gestures', () => {
  it('accepts trusted Command and Control Enter', () => {
    expect(isTrustedSubmitShortcut(commandEnter)).toBe(true);
    expect(isTrustedSubmitShortcut({ ...commandEnter, metaKey: false, ctrlKey: true })).toBe(true);
  });
  it.each([
    { isTrusted: false },
    { key: 'a' },
    { metaKey: false },
    { altKey: true },
    { shiftKey: true },
    { repeat: true },
    { isComposing: true },
  ])('does not grant activation for %j', (changes) => {
    expect(isTrustedSubmitShortcut({ ...commandEnter, ...changes })).toBe(false);
  });
});
