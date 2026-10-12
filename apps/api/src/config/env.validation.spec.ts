import 'reflect-metadata';
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = {
    NODE_ENV: 'development',
    DB_HOST: 'localhost',
    DB_NAME: 'ops',
    DB_USER: 'app',
    DB_PASSWORD: 'placeholder',
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

  describe('database', () => {
    it('reads the connection settings, and defaults the port and TLS', () => {
      expect(validateEnv(valid)).toMatchObject({
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_NAME: 'ops',
        DB_USER: 'app',
        DB_PASSWORD: 'placeholder',
        DB_SSL: false,
      });
    });

    it('accepts another port, TLS, and a password with URL-reserved characters', () => {
      const password = 'p@ss:w/rd%23?';

      expect(
        validateEnv({ ...valid, DB_PORT: '15432', DB_SSL: 'true', DB_PASSWORD: password }),
      ).toMatchObject({ DB_PORT: 15432, DB_SSL: true, DB_PASSWORD: password });
    });

    it.each(['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'])(
      'requires %s, missing or empty: there is no default database',
      (name) => {
        expect(() => validateEnv({ ...valid, [name]: undefined })).toThrow(new RegExp(name));
        expect(() => validateEnv({ ...valid, [name]: '' })).toThrow(new RegExp(name));
      },
    );

    it.each([
      ['not a number', 'abc'],
      ['zero', '0'],
      ['above the range', '65536'],
    ])('rejects a DB_PORT that is %s, naming the key', (_, port) => {
      expect(() => validateEnv({ ...valid, DB_PORT: port })).toThrow(/DB_PORT/);
    });

    it('does not read DATABASE_URL in place of the DB_* settings', () => {
      expect(() =>
        validateEnv({
          ...valid,
          DB_HOST: undefined,
          DATABASE_URL: 'postgres://app:placeholder@localhost:5432/ops',
        }),
      ).toThrow(/DB_HOST/);
    });

    it('never echoes the password when another setting is rejected', () => {
      let message = '';
      try {
        validateEnv({ ...valid, DB_PASSWORD: 'value-must-not-leak', DB_PORT: 'abc' });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toMatch(/DB_PORT/);
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
      LOG_LEVEL: 'debug',
      DEPLOYMENT_ENV: 'local',
    });
  });

  it('applies the documented test defaults', () => {
    expect(validateEnv({ ...valid, NODE_ENV: 'test' })).toMatchObject({
      LOG_LEVEL: 'warn',
      DEPLOYMENT_ENV: 'test',
    });
  });

  describe('logging', () => {
    it('accepts a LOG_LEVEL override', () => {
      expect(validateEnv({ ...valid, LOG_LEVEL: 'trace' }).LOG_LEVEL).toBe('trace');
    });

    it.each([
      ["Nest's name for trace", 'verbose'],
      ['unknown', 'loud'],
    ])('rejects a LOG_LEVEL that is %s, naming the key', (_, level) => {
      expect(() => validateEnv({ ...valid, LOG_LEVEL: level })).toThrow(/LOG_LEVEL/);
    });

    it('rejects an unknown DEPLOYMENT_ENV, naming the key', () => {
      expect(() => validateEnv({ ...valid, DEPLOYMENT_ENV: 'prod' })).toThrow(/DEPLOYMENT_ENV/);
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

  describe('METRICS_PORT', () => {
    it('defaults to 9464 when unset', () => {
      expect(validateEnv(valid).METRICS_PORT).toBe(9464);
    });

    it('accepts another port', () => {
      expect(validateEnv({ ...valid, METRICS_PORT: '19464' }).METRICS_PORT).toBe(19464);
    });

    it.each([
      ['zero', '0'],
      ['above 65535', '65536'],
      ['fractional', '9464.5'],
      ['not a number', 'abc'],
    ])('rejects a value that is %s, naming the key', (_, value) => {
      expect(() => validateEnv({ ...valid, METRICS_PORT: value })).toThrow(/METRICS_PORT/);
    });

    it('rejects the API port: the scrape endpoint has a listener of its own (ADR-0015)', () => {
      expect(() => validateEnv({ ...valid, PORT: '13000', METRICS_PORT: '13000' })).toThrow(
        /METRICS_PORT: must differ from PORT/,
      );
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
      DEPLOYMENT_ENV: 'production',
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

    it('requires DEPLOYMENT_ENV, so staging cannot be tagged production by omission', () => {
      expect(() => validateEnv({ ...production, ...mediamtx, DEPLOYMENT_ENV: undefined })).toThrow(
        /DEPLOYMENT_ENV: .*production has no default/,
      );
    });

    it('accepts staging, which runs the production image', () => {
      const env = validateEnv({ ...production, ...mediamtx, DEPLOYMENT_ENV: 'staging' });

      expect(env).toMatchObject({ NODE_ENV: 'production', DEPLOYMENT_ENV: 'staging' });
    });

    it('logs at info by default', () => {
      expect(validateEnv({ ...production, ...mediamtx }).LOG_LEVEL).toBe('info');
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
