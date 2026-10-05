import 'reflect-metadata';
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://app:placeholder@localhost:5432/ops',
    OIDC_ISSUER: 'http://localhost:15173/auth/realms/occ',
    OIDC_JWKS_URL: 'http://localhost:18081/auth/realms/occ/protocol/openid-connect/certs',
    OIDC_AUDIENCE: 'occ-api',
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

  describe('OIDC', () => {
    it.each(['OIDC_ISSUER', 'OIDC_JWKS_URL', 'OIDC_AUDIENCE'])(
      'requires %s in every environment: there is no way to turn authentication off',
      (name) => {
        expect(() => validateEnv({ ...valid, [name]: undefined })).toThrow(new RegExp(name));
      },
    );

    it('accepts an internal JWKS address, such as the Compose service host', () => {
      const jwksUrl = 'http://keycloak:8080/auth/realms/occ/protocol/openid-connect/certs';
      expect(validateEnv({ ...valid, OIDC_JWKS_URL: jwksUrl }).OIDC_JWKS_URL).toBe(jwksUrl);
    });
  });

  it('applies the documented development defaults', () => {
    expect(validateEnv(valid)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      TRUST_PROXY_HOPS: 1,
      RATE_LIMIT_ENABLED: true,
      SEED_ON_BOOT: true,
      SIMULATOR_ENABLED: false,
      CAMERA_SOURCE: 'mock',
      DEMO_MODE: false,
    });
  });

  describe('TRUST_PROXY_HOPS', () => {
    it.each([
      ['0', 0],
      ['2', 2],
    ])('accepts %s', (value, hops) => {
      expect(validateEnv({ ...valid, TRUST_PROXY_HOPS: value }).TRUST_PROXY_HOPS).toBe(hops);
    });

    it.each([
      ['negative', '-1'],
      ['fractional', '1.5'],
      ['above the cap', '6'],
      ['not a number', 'all'],
    ])('rejects a value that is %s, naming the key', (_, value) => {
      expect(() => validateEnv({ ...valid, TRUST_PROXY_HOPS: value })).toThrow(/TRUST_PROXY_HOPS/);
    });
  });

  it('lets development turn rate limiting off', () => {
    expect(validateEnv({ ...valid, RATE_LIMIT_ENABLED: 'false' }).RATE_LIMIT_ENABLED).toBe(false);
  });

  describe('in production', () => {
    // An https issuer, so only the rule a case is about can fail.
    const production = {
      ...valid,
      NODE_ENV: 'production',
      OIDC_ISSUER: 'https://sso.example.org/realms/occ',
    };
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

    it('rejects an http issuer without DEMO_MODE', () => {
      const env = {
        ...production,
        ...mediamtx,
        OIDC_ISSUER: 'http://localhost:18080/auth/realms/occ',
      };

      expect(() => validateEnv(env)).toThrow(/OIDC_ISSUER: http needs DEMO_MODE=true/);
    });

    it('allows an http issuer when DEMO_MODE opts in, as the Compose demo does', () => {
      const issuer = 'http://localhost:18080/auth/realms/occ';
      const env = { ...production, ...mediamtx, OIDC_ISSUER: issuer, DEMO_MODE: 'true' };

      expect(validateEnv(env).OIDC_ISSUER).toBe(issuer);
    });

    it('refuses to turn rate limiting off', () => {
      expect(() =>
        validateEnv({ ...production, ...mediamtx, RATE_LIMIT_ENABLED: 'false' }),
      ).toThrow(/RATE_LIMIT_ENABLED: false is not allowed in production/);
    });

    it('refuses to turn rate limiting off even with DEMO_MODE: the demo enforces it too', () => {
      const env = {
        ...production,
        CAMERA_SOURCE: 'mock',
        DEMO_MODE: 'true',
        RATE_LIMIT_ENABLED: 'false',
      };

      expect(() => validateEnv(env)).toThrow(
        /RATE_LIMIT_ENABLED: false is not allowed in production/,
      );
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
