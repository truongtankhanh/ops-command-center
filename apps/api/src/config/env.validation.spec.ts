import 'reflect-metadata';
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://app:placeholder@localhost:5432/ops',
  };

  it.each([
    ['missing', undefined],
    ['unknown', 'staging'],
  ])('rejects a NODE_ENV that is %s, naming the key', (_, nodeEnv) => {
    expect(() => validateEnv({ ...valid, NODE_ENV: nodeEnv })).toThrow(/NODE_ENV/);
  });

  describe('DATABASE_URL', () => {
    it.each([
      ['a local URL', 'postgres://app:placeholder@localhost:15432/ops'],
      ['the Compose service host', 'postgres://app:placeholder@postgres:5432/ops'],
      ['postgresql with options', 'postgresql://app@db.internal:5432/ops?sslmode=require'],
    ])('accepts %s', (_, url) => {
      expect(validateEnv({ ...valid, DATABASE_URL: url }).DATABASE_URL).toBe(url);
    });

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['without a scheme', 'localhost:5432/ops'],
      ['another database scheme', 'mysql://app:placeholder@localhost:3306/ops'],
      ['an http URL', 'http://localhost:5432/ops'],
    ])('rejects a value that is %s, naming the key', (_, url) => {
      expect(() => validateEnv({ ...valid, DATABASE_URL: url })).toThrow(/DATABASE_URL/);
    });

    it('never echoes the rejected value', () => {
      let message = '';
      try {
        validateEnv({ ...valid, DATABASE_URL: 'mysql://app:value-must-not-leak@localhost/ops' });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toMatch(/DATABASE_URL/);
      expect(message).not.toContain('value-must-not-leak');
    });
  });

  it('applies the documented development defaults', () => {
    expect(validateEnv(valid)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      SEED_ON_BOOT: true,
      SIMULATOR_ENABLED: false,
      CAMERA_SOURCE: 'mock',
      DEMO_MODE: false,
    });
  });

  describe('in production', () => {
    const production = { ...valid, NODE_ENV: 'production' };
    const mediamtx = {
      CAMERA_SOURCE: 'mediamtx',
      MEDIAMTX_HLS_URL: 'http://mediamtx:8888',
      MEDIAMTX_WEBRTC_URL: 'http://mediamtx:8889',
    };

    it('requires CAMERA_SOURCE to be set explicitly', () => {
      expect(() => validateEnv(production)).toThrow(/CAMERA_SOURCE/);
    });

    it('rejects mock cameras without DEMO_MODE', () => {
      expect(() => validateEnv({ ...production, CAMERA_SOURCE: 'mock' })).toThrow(
        /CAMERA_SOURCE: mock needs DEMO_MODE=true/,
      );
    });

    it('rejects SEED_ON_BOOT=true without DEMO_MODE', () => {
      expect(() => validateEnv({ ...production, ...mediamtx, SEED_ON_BOOT: 'true' })).toThrow(
        /SEED_ON_BOOT: true needs DEMO_MODE=true/,
      );
    });

    it('does not seed by default', () => {
      expect(validateEnv({ ...production, ...mediamtx })).toMatchObject({
        CAMERA_SOURCE: 'mediamtx',
        SEED_ON_BOOT: false,
      });
    });

    it('allows the demo behaviour when DEMO_MODE opts in', () => {
      const env = { ...production, CAMERA_SOURCE: 'mock', SEED_ON_BOOT: 'true', DEMO_MODE: 'true' };

      expect(validateEnv(env)).toMatchObject({
        CAMERA_SOURCE: 'mock',
        SEED_ON_BOOT: true,
        DEMO_MODE: true,
      });
    });
  });
});
