import { LABEL_MARGIN_PX, labelTransform, stagePoint } from './twinLabels';

const WIDTH = 1000;
const HEIGHT = 600;

describe('stagePoint', () => {
  it('puts the middle of the view in the middle of the stage', () => {
    expect(stagePoint([0, 0, 0.5], WIDTH, HEIGHT)).toEqual({ x: 500, y: 300, visible: true });
  });

  it('measures x from the left and y from the top, so NDC up is a smaller y', () => {
    expect(stagePoint([-1, 1, 0.5], WIDTH, HEIGHT)).toMatchObject({ x: 0, y: 0 });
    expect(stagePoint([1, -1, 0.5], WIDTH, HEIGHT)).toMatchObject({ x: 1000, y: 600 });
    expect(stagePoint([0, 0.5, 0.5], WIDTH, HEIGHT).y).toBe(150);
  });

  it('hides a point behind the camera, which projects with z above 1', () => {
    expect(stagePoint([0, 0, 1.0002], WIDTH, HEIGHT).visible).toBe(false);
  });

  it('hides a point nearer than the near plane, and shows the planes themselves', () => {
    expect(stagePoint([0, 0, -1.01], WIDTH, HEIGHT).visible).toBe(false);
    expect(stagePoint([0, 0, -1], WIDTH, HEIGHT).visible).toBe(true);
    expect(stagePoint([0, 0, 1], WIDTH, HEIGHT).visible).toBe(true);
  });

  it('keeps a point just outside the stage, within the margin, and hides one beyond it', () => {
    expect(LABEL_MARGIN_PX).toBe(64);
    // The NDC x of a pixel column of the stage.
    const column = (px: number) => (px / WIDTH) * 2 - 1;

    expect(stagePoint([column(-60), 0, 0.5], WIDTH, HEIGHT).visible).toBe(true);
    expect(stagePoint([column(-70), 0, 0.5], WIDTH, HEIGHT).visible).toBe(false);
    expect(stagePoint([column(WIDTH + 60), 0, 0.5], WIDTH, HEIGHT).visible).toBe(true);
    expect(stagePoint([column(WIDTH + 70), 0, 0.5], WIDTH, HEIGHT).visible).toBe(false);
    expect(stagePoint([0, 1.5, 0.5], WIDTH, HEIGHT).visible).toBe(false);
  });

  it('takes another margin, and none at all', () => {
    expect(stagePoint([-1.01, 0, 0.5], WIDTH, HEIGHT, 0).visible).toBe(false);
    expect(stagePoint([-1.01, 0, 0.5], WIDTH, HEIGHT, 10).visible).toBe(true);
    expect(stagePoint([-1, 0, 0.5], WIDTH, HEIGHT, 0).visible).toBe(true);
  });

  it('hides a point that is not a number', () => {
    expect(stagePoint([Number.NaN, 0, 0.5], WIDTH, HEIGHT).visible).toBe(false);
  });
});

describe('labelTransform', () => {
  it('moves the label to the point and centres it on it', () => {
    expect(labelTransform(120, 48)).toBe('translate(120px, 48px) translate(-50%, -50%)');
  });

  it('rounds to a tenth of a pixel, so a settled camera writes the same string', () => {
    expect(labelTransform(120.04, 48.26)).toBe(labelTransform(120.0, 48.3));
    expect(labelTransform(120.04, 48.26)).toBe('translate(120px, 48.3px) translate(-50%, -50%)');
  });

  it('writes a negative position', () => {
    expect(labelTransform(-12.34, -0.04)).toBe('translate(-12.3px, 0px) translate(-50%, -50%)');
  });
});
