// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync }));
import { readTaggedReleaseFile } from '../scripts/release-identity.js';

beforeEach(() => execFileSync.mockReset());
describe('tagged extension release files', () => {
  it.each(['LICENSE', 'README.md', 'PRIVACY.md'])(
    'reads the extension %s from a monorepo commit',
    (file) => {
      const bytes = Buffer.from('extension-owned document');
      execFileSync.mockReturnValueOnce('byoa-extension/\n').mockReturnValueOnce(bytes);
      expect(readTaggedReleaseFile('/repo/byoa-extension', 'reviewed-commit', file)).toBe(bytes);
      expect(execFileSync).toHaveBeenNthCalledWith(
        2,
        'git',
        ['show', `reviewed-commit:byoa-extension/${file}`],
        { cwd: '/repo/byoa-extension' }
      );
    }
  );
  it('also works in a standalone extension repository', () => {
    const bytes = Buffer.from('standalone license');
    execFileSync.mockReturnValueOnce('').mockReturnValueOnce(bytes);
    expect(readTaggedReleaseFile('/extension', 'reviewed-commit', 'LICENSE')).toBe(bytes);
    expect(execFileSync).toHaveBeenNthCalledWith(2, 'git', ['show', 'reviewed-commit:LICENSE'], {
      cwd: '/extension',
    });
  });
});
