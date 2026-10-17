import { isLoading, type LoadStep, loadedShare, twinLoadSteps } from './twinLoading';

const step = (state: LoadStep['state']): LoadStep => ({
  id: state,
  label: state,
  detail: '',
  state,
});
const states = (steps: LoadStep[]) => steps.map(({ id, state }) => [id, state]);

describe('twinLoadSteps', () => {
  it('lists the site plan, then the 3D code, with what each comes from', () => {
    const steps = twinLoadSteps({ codeLoaded: false, sitePlan: 'pending' });

    expect(steps.map(({ id, label, detail }) => [id, label, detail])).toEqual([
      ['site-plan', 'Site plan', 'from the API'],
      ['code', '3D view code', 'from this site'],
    ]);
  });

  it('has both steps active at the start: they load at the same time', () => {
    expect(states(twinLoadSteps({ codeLoaded: false, sitePlan: 'pending' }))).toEqual([
      ['site-plan', 'active'],
      ['code', 'active'],
    ]);
  });

  it('finishes the code step when the chunk has arrived', () => {
    expect(states(twinLoadSteps({ codeLoaded: true, sitePlan: 'pending' }))).toEqual([
      ['site-plan', 'active'],
      ['code', 'done'],
    ]);
  });

  it('finishes the site plan step when the zones are in', () => {
    expect(states(twinLoadSteps({ codeLoaded: false, sitePlan: 'ready' }))).toEqual([
      ['site-plan', 'done'],
      ['code', 'active'],
    ]);
  });

  it('fails the site plan step, and says so in its detail', () => {
    const steps = twinLoadSteps({ codeLoaded: true, sitePlan: 'failed' });

    expect(steps[0]).toMatchObject({ state: 'failed', detail: 'couldn’t load' });
    expect(steps[1]).toMatchObject({ state: 'done' });
  });
});

describe('isLoading', () => {
  it('is true while a step is active or queued', () => {
    expect(isLoading([step('done'), step('active')])).toBe(true);
    expect(isLoading([step('done'), step('queued')])).toBe(true);
  });

  it('is false when everything is done', () => {
    expect(isLoading(twinLoadSteps({ codeLoaded: true, sitePlan: 'ready' }))).toBe(false);
  });

  it('is false for a failed step: it waits for the operator, not for the network', () => {
    expect(isLoading(twinLoadSteps({ codeLoaded: true, sitePlan: 'failed' }))).toBe(false);
  });

  it('is false for no steps', () => {
    expect(isLoading([])).toBe(false);
  });
});

describe('loadedShare', () => {
  it('is the share of steps done', () => {
    expect(loadedShare([step('active'), step('active')])).toBe(0);
    expect(loadedShare([step('done'), step('active')])).toBe(0.5);
    expect(loadedShare([step('done'), step('done')])).toBe(1);
  });

  it('does not count a failed or a queued step as done', () => {
    expect(loadedShare([step('done'), step('failed'), step('queued'), step('done')])).toBe(0.5);
  });

  it('is 1 when there is nothing to wait for', () => {
    expect(loadedShare([])).toBe(1);
  });
});
