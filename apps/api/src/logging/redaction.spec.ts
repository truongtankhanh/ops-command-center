import { Writable } from 'node:stream';
import pino from 'pino';
import { REDACT_PATHS, REDACTED, scrubSecrets } from './redaction';

/** What pino writes for one `info` call, parsed, with the same redaction the app configures. */
function logged(object: Record<string, unknown>): Record<string, unknown> {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString('utf8'));
      done();
    },
  });
  pino({ redact: { paths: REDACT_PATHS, censor: REDACTED } }, destination).info(object, 'line');
  return JSON.parse(lines.join('')) as Record<string, unknown>;
}

describe('redaction', () => {
  describe('by key', () => {
    it.each(['MQTT_PASSWORD', 'DB_PASSWORD'])('masks %s at the top level', (key) => {
      expect(logged({ [key]: 'not-a-real-secret' })).toMatchObject({ [key]: REDACTED });
    });

    it('masks MQTT_PASSWORD one level down, as in a dumped config object', () => {
      const line = logged({ config: { MQTT_PASSWORD: 'not-a-real-secret', MQTT_USERNAME: 'api' } });

      expect(line.config).toEqual({ MQTT_PASSWORD: REDACTED, MQTT_USERNAME: 'api' });
    });

    it('masks the `password` option of a client options object', () => {
      const line = logged({ options: { username: 'api', password: 'not-a-real-secret' } });

      expect(line.options).toEqual({ username: 'api', password: REDACTED });
    });

    it('leaves an ordinary field alone', () => {
      expect(logged({ assetCode: 'CT-01' })).toMatchObject({ assetCode: 'CT-01' });
    });
  });

  describe('scrubSecrets', () => {
    it('masks the credentials of an MQTT URL and keeps its scheme and host', () => {
      expect(scrubSecrets('connect failed: mqtts://api:hunter2@mosquitto:8883')).toBe(
        `connect failed: mqtts://${REDACTED}@mosquitto:8883`,
      );
    });

    it('leaves a URL without credentials alone', () => {
      const text = 'MQTT telemetry source on: mqtts://mosquitto:8883';

      expect(scrubSecrets(text)).toBe(text);
    });

    it('keeps a serialized log line valid JSON', () => {
      const line = JSON.stringify({ msg: 'failed mqtt://api:hunter2@broker:1883', level: 'warn' });

      const parsed = JSON.parse(scrubSecrets(line)) as { msg: string };

      expect(parsed.msg).toBe(`failed mqtt://${REDACTED}@broker:1883`);
    });
  });
});
