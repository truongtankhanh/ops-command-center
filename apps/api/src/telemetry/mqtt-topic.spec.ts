import { MAX_PAYLOAD_BYTES, parseTopic, SUBSCRIPTION_FILTER } from './mqtt-topic';

describe('parseTopic', () => {
  it.each(['telemetry', 'status'] as const)('reads a %s topic', (kind) => {
    expect(parseTopic(`occ/LANGBIANG/asset/CT-01/${kind}`)).toEqual({
      kind,
      siteCode: 'LANGBIANG',
      assetCode: 'CT-01',
    });
  });

  it('does not filter on the site: another code parses, and the source decides', () => {
    expect(parseTopic('occ/OTHER/asset/CT-01/telemetry')).toMatchObject({ siteCode: 'OTHER' });
  });

  it('keeps an asset code as the device sent it, without judging its shape', () => {
    expect(parseTopic('occ/LANGBIANG/asset/not a code/status')).toMatchObject({
      assetCode: 'not a code',
    });
  });

  it.each([
    ['an empty topic', ''],
    ['a topic with too few levels', 'occ/LANGBIANG/asset/CT-01'],
    ['a topic with too many levels', 'occ/LANGBIANG/asset/CT-01/telemetry/extra'],
    ['a sub-topic that is not ours', 'occ/LANGBIANG/asset/CT-01/cmd'],
    ['a sub-topic in another case', 'occ/LANGBIANG/asset/CT-01/Telemetry'],
    ['an empty site code', 'occ//asset/CT-01/telemetry'],
    ['an empty asset code', 'occ/LANGBIANG/asset//telemetry'],
    ['another root', 'xyz/LANGBIANG/asset/CT-01/telemetry'],
    ['another third level', 'occ/LANGBIANG/assets/CT-01/telemetry'],
    ['a leading slash', '/occ/LANGBIANG/asset/CT-01/telemetry'],
  ])('is undefined for %s', (_, topic) => {
    expect(parseTopic(topic)).toBeUndefined();
  });

  it('shares the one subscription filter and payload limit of ADR-0019', () => {
    expect(SUBSCRIPTION_FILTER).toBe('occ/+/asset/+/#');
    expect(MAX_PAYLOAD_BYTES).toBe(4096);
  });
});
