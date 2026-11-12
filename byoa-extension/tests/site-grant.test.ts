import { describe, it, expect } from 'vitest';
import { validateSiteGrant, validateSiteShare } from '../src/lib/site-grant';
describe('site grants', () => {
  it.each([undefined, null, false, 'true', {}, { persona: 'true', user: 1, memory: [] }])(
    'defaults malformed sharing to false: %j',
    (value) => {
      expect(validateSiteShare(value)).toEqual({ persona: false, user: false, memory: false });
    }
  );
  it('accepts only real booleans and valid agent ids', () => {
    expect(
      validateSiteGrant({ agentId: 'a', share: { persona: true, user: false, memory: true } })
    ).toEqual({
      agentId: 'a',
      share: { persona: true, user: false, memory: true },
      persist: 'session',
      createdAt: 0,
    });
    expect(validateSiteGrant({ agentId: 1 })).toBeUndefined();
  });
});
