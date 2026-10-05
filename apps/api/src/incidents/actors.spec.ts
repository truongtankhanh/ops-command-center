import type { AuthenticatedUser } from '../auth/token-verifier';
import { userActor } from './actors';

const user = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  subject: 'user-1',
  displayName: 'Demo Operator',
  roles: ['operator'],
  ...overrides,
});

describe('userActor', () => {
  it("records the user's subject and display name, and nothing else from the token", () => {
    expect(userActor(user())).toEqual({
      kind: 'user',
      subject: 'user-1',
      displayName: 'Demo Operator',
    });
  });

  it('keeps a display name of exactly 255 characters', () => {
    const displayName = 'a'.repeat(255);

    expect(userActor(user({ displayName })).displayName).toBe(displayName);
  });

  it('cuts a longer display name to the 255 characters the column holds', () => {
    expect(userActor(user({ displayName: 'a'.repeat(300) })).displayName).toBe('a'.repeat(255));
  });

  it('counts characters, not UTF-16 units, so no character is split in half', () => {
    const displayName = '😀'.repeat(300); // 600 UTF-16 units

    expect(userActor(user({ displayName })).displayName).toBe('😀'.repeat(255));
  });

  it('never cuts the subject', () => {
    const subject = 's'.repeat(300);

    expect(userActor(user({ subject })).subject).toBe(subject);
  });
});
