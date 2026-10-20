import { fireEvent } from '@testing-library/react';
import type { PickDone } from './twinPicker';
import type { PickRef, ScreenPoint } from './twinPicking';
import { attachPointer, type PointerHandle } from './twinPointer';

// The canvas sits at (10, 20) in the page, so a point at page (110, 120) is (100, 100) on the canvas.
const LEFT = 10;
const TOP = 20;

const asset = (id: string): PickRef => ({ kind: 'asset', id });
const part = (id: string, assetCode: string): PickRef => ({ kind: 'part', id, assetCode });
const building = (id: string): PickRef => ({ kind: 'building', id });
const camera = (id: string): PickRef => ({ kind: 'camera', id });
const beacon = (id: string): PickRef => ({ kind: 'beacon', id });
const place = (x: number, y: number, z: number): PickRef => ({ kind: 'ground', x, y, z });

interface Request {
  point: ScreenPoint;
  done?: PickDone;
}

/** Every pointer a test attached, detached after it: their listeners are on the shared `document`. */
const attached: PointerHandle[] = [];

function setup(
  initial: {
    picking?: boolean;
    assetCode?: string | null;
    part?: string | null;
    incidentId?: string | null;
  } = {},
) {
  const element = document.createElement('div');
  element.getBoundingClientRect = () =>
    ({
      left: LEFT,
      top: TOP,
      right: LEFT + 800,
      bottom: TOP + 600,
      width: 800,
      height: 600,
    }) as DOMRect;
  document.body.append(element);

  const state = {
    picking: initial.picking ?? false,
    /** Whether the report's pin is under the pointer, and where it was asked. */
    pin: false,
    pinChecks: [] as ScreenPoint[],
    selection: {
      assetCode: initial.assetCode ?? null,
      part: initial.part ?? null,
      incidentId: initial.incidentId ?? null,
    },
  };
  const requests: Request[] = [];
  let listener: ((ref: PickRef | null) => void) | null = null;
  let unsubscribed = false;
  const actions = {
    hoverAsset: vi.fn(),
    hoverPart: vi.fn(),
    toggleAsset: vi.fn(),
    selectPart: vi.fn(),
    focusBuilding: vi.fn(),
    openViewer: vi.fn(),
    selectIncident: vi.fn(),
    placePin: vi.fn(),
    previewPin: vi.fn(),
    dropPin: vi.fn(),
  };
  const deps = {
    requestPick: (point: ScreenPoint, done?: PickDone) => {
      requests.push({ point, done });
    },
    onPick: (next: (ref: PickRef | null) => void) => {
      listener = next;
      return () => {
        unsubscribed = true;
        listener = null;
      };
    },
    lastPick: (): PickRef | null => null,
    pinAt: (point: ScreenPoint) => {
      state.pinChecks.push(point);
      return state.pin;
    },
    isPicking: () => state.picking,
    selection: () => state.selection,
    focusZoneOf: (code: string) => (code === 'CT-01' ? 'BLD-DC' : null),
    actions,
  };
  const handle: PointerHandle = attachPointer(element, deps);
  attached.push(handle);

  /** What the canvas does in a frame: publishes a changed winner, then calls the completion of the request. */
  const answer = (ref: PickRef | null) => {
    const request = requests.at(-1);
    listener?.(ref);
    request?.done?.(ref);
  };
  const init = (x: number, y: number, extra: PointerEventInit = {}): PointerEventInit => ({
    clientX: x + LEFT,
    clientY: y + TOP,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    ...extra,
  });
  const down = (x: number, y: number, extra?: PointerEventInit) =>
    fireEvent.pointerDown(element, init(x, y, { buttons: 1, ...extra }));
  const move = (x: number, y: number, extra?: PointerEventInit) =>
    fireEvent.pointerMove(element, init(x, y, extra));
  const up = (x: number, y: number, extra?: PointerEventInit) =>
    fireEvent.pointerUp(document.body, init(x, y, extra));
  const click = (x: number, y: number, ref: PickRef | null) => {
    down(x, y);
    up(x, y);
    answer(ref);
  };

  return {
    element,
    state,
    requests,
    actions,
    handle,
    answer,
    down,
    move,
    up,
    click,
    unsubscribed: () => unsubscribed,
  };
}

afterEach(() => {
  for (const handle of attached.splice(0)) handle.detach();
  document.body.replaceChildren();
});

describe('a click', () => {
  it('is a press released within 3 px, and asks for the pick at the release point', () => {
    const { requests, down, up } = setup();

    down(100, 100);
    up(102, 100);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.point).toEqual({ x: 102, y: 100 });
    expect(requests[0]!.done).toBeTypeOf('function');
  });

  it('is not a click when the press moved 4 px', () => {
    const { requests, actions, down, up } = setup();

    down(100, 100);
    up(104, 100);

    expect(requests).toEqual([]);
    expect(actions.toggleAsset).not.toHaveBeenCalled();
  });

  it('is still heard when the release is outside the canvas, on the document', () => {
    const { requests, down, up } = setup();

    down(100, 100);
    up(100, 100);

    expect(requests).toHaveLength(1);
  });

  it('toggles an asset with the building it is in', () => {
    const { actions, click } = setup();

    click(100, 100, asset('CT-01'));

    expect(actions.toggleAsset).toHaveBeenCalledWith('CT-01', 'BLD-DC');
  });

  it('toggles an asset outside every building with no building', () => {
    const { actions, click } = setup();

    click(100, 100, asset('TR-01'));

    expect(actions.toggleAsset).toHaveBeenCalledWith('TR-01', null);
  });

  it('selects a part, and closes the callout of the selected part', () => {
    const first = setup({ assetCode: 'CT-01' });
    first.click(100, 100, part('FanBlade', 'CT-01'));
    expect(first.actions.selectPart).toHaveBeenCalledWith('FanBlade');

    const second = setup({ assetCode: 'CT-01', part: 'FanBlade' });
    second.click(100, 100, part('FanBlade', 'CT-01'));
    expect(second.actions.selectPart).toHaveBeenCalledWith(null);
  });

  it('closes the callout, and not the inspector, on the body of the isolated asset at part level', () => {
    const { actions, click } = setup({ assetCode: 'CT-01', part: 'FanBlade' });

    click(100, 100, asset('CT-01'));

    expect(actions.selectPart).toHaveBeenCalledWith(null);
    expect(actions.toggleAsset).not.toHaveBeenCalled();
  });

  it('toggles the isolated asset off from its body at asset level', () => {
    const { actions, click } = setup({ assetCode: 'CT-01' });

    click(100, 100, asset('CT-01'));

    expect(actions.toggleAsset).toHaveBeenCalledWith('CT-01', 'BLD-DC');
  });

  it('focuses a building and opens a camera', () => {
    const { actions, click } = setup();

    click(100, 100, building('BLD-DC'));
    click(100, 100, camera('cam-1'));

    expect(actions.focusBuilding).toHaveBeenCalledWith('BLD-DC');
    expect(actions.openViewer).toHaveBeenCalledWith('cam-1');
  });

  it('selects the incident of a beacon (V2-16.4)', () => {
    const { actions, click } = setup();

    click(100, 100, beacon('inc-1'));

    expect(actions.selectIncident).toHaveBeenCalledWith('inc-1');
    expect(actions.toggleAsset).not.toHaveBeenCalled();
  });

  it('deselects the incident when its beacon is clicked again, and selects another', () => {
    const { actions, click } = setup({ incidentId: 'inc-1' });

    click(100, 100, beacon('inc-1'));
    expect(actions.selectIncident).toHaveBeenLastCalledWith(null);

    click(100, 100, beacon('inc-2'));
    expect(actions.selectIncident).toHaveBeenLastCalledWith('inc-2');
  });

  it('does nothing on nothing', () => {
    const { actions, click } = setup();

    click(100, 100, null);

    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  });

  // V2-16.7: a click while a report location is picked asks for the place under it and places the pin there.
  describe('while a report location is picked', () => {
    it('asks for the pick at the release point, as a click does', () => {
      const { requests, state, down, up } = setup();
      state.picking = true;

      down(100, 100);
      up(100, 100);

      expect(requests).toHaveLength(1);
      expect(requests[0]!.point).toEqual({ x: 100, y: 100 });
      expect(requests[0]!.done).toBeTypeOf('function');
    });

    it('places the pin at the place the answer names, and does nothing else', () => {
      const { actions, state, click } = setup();
      state.picking = true;

      click(100, 100, place(12, 18, -30));

      expect(actions.placePin).toHaveBeenCalledExactlyOnceWith([12, 18, -30]);
      for (const [name, action] of Object.entries(actions)) {
        if (name !== 'placePin') expect(action).not.toHaveBeenCalled();
      }
    });

    it('does nothing with an answer that is a thing or nothing', () => {
      const { actions, requests, state, down, up } = setup();
      state.picking = true;
      // The click's own completion only: what a stream of published picks does to the hover is another case.
      const answerClick = (ref: PickRef | null) => {
        down(100, 100);
        up(100, 100);
        requests.at(-1)!.done!(ref);
      };

      answerClick(asset('CT-01'));
      answerClick(building('BLD-DC'));
      answerClick(camera('cam-1'));
      answerClick(beacon('inc-1'));
      answerClick(null);

      for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
    });

    it('does nothing with a place when picking ended before the answer arrived', () => {
      const { actions, state, down, up, answer } = setup();
      state.picking = true;
      down(100, 100);
      up(100, 100);
      state.picking = false;

      answer(place(1, 2, 3));

      expect(actions.placePin).not.toHaveBeenCalled();
    });

    it('does nothing with a thing when picking began after the click was asked for', () => {
      const { actions, state, down, up, answer } = setup();
      down(100, 100);
      up(100, 100);
      state.picking = true;

      answer(asset('CT-01'));

      expect(actions.toggleAsset).not.toHaveBeenCalled();
    });

    it('does not place a pin for a drag, a pinch or another button: those are the camera’s', () => {
      const { requests, state, down, up } = setup();
      state.picking = true;

      down(100, 100);
      up(140, 100);
      down(100, 100, { button: 2 });
      up(100, 100, { button: 2 });
      down(100, 100, { pointerId: 1, pointerType: 'touch' });
      down(150, 100, { pointerId: 2, pointerType: 'touch' });
      up(150, 100, { pointerId: 2, pointerType: 'touch' });
      up(100, 100, { pointerId: 1, pointerType: 'touch' });

      expect(requests).toEqual([]);
    });

    it('is a tap on a touch screen: the pin is placed, and no hover is written', () => {
      const { actions, state, down, up, answer } = setup();
      state.picking = true;

      down(100, 100, { pointerType: 'touch' });
      up(100, 100, { pointerType: 'touch' });
      answer(place(4, 0, 9));

      expect(actions.placePin).toHaveBeenCalledWith([4, 0, 9]);
      expect(actions.hoverAsset).not.toHaveBeenCalled();
    });

    it('selects or toggles nothing in the console while it places a pin', () => {
      const { actions, state, click } = setup({ assetCode: 'CT-01', incidentId: 'inc-1' });
      state.picking = true;

      click(100, 100, place(0, 0, 0));

      expect(actions.toggleAsset).not.toHaveBeenCalled();
      expect(actions.selectIncident).not.toHaveBeenCalled();
    });
  });

  it.each([1, 2])('is never made by button %i, which is the camera’s', (button) => {
    const { requests, down, up } = setup();

    down(100, 100, { button });
    up(100, 100, { button });

    expect(requests).toEqual([]);
  });

  it('is never made while a second pointer is down (a pinch)', () => {
    const { requests, down, up } = setup();

    down(100, 100, { pointerId: 1, pointerType: 'touch' });
    down(150, 100, { pointerId: 2, pointerType: 'touch' });
    up(150, 100, { pointerId: 2, pointerType: 'touch' });
    up(100, 100, { pointerId: 1, pointerType: 'touch' });

    expect(requests).toEqual([]);
  });

  it('is a tap on a touch screen, and a tap sets no hover', () => {
    const { requests, actions, down, up, answer } = setup();

    down(100, 100, { pointerType: 'touch' });
    up(101, 100, { pointerType: 'touch' });
    answer(asset('CT-01'));

    expect(requests).toHaveLength(1);
    expect(actions.toggleAsset).toHaveBeenCalledWith('CT-01', 'BLD-DC');
    expect(actions.hoverAsset).not.toHaveBeenCalled();
  });
});

// V2-16.7: while a location is picked, the report's pin can be grabbed and dragged to another place.
describe('dragging the report’s pin', () => {
  /** A setup with a location being picked and the pin under the pointer. */
  function grabbed() {
    const view = setup();
    view.state.picking = true;
    view.state.pin = true;
    return view;
  }
  /** The canvas answers the latest request: a place, a thing or nothing. */
  const reply = (requests: Request[], ref: PickRef | null) => requests.at(-1)!.done!(ref);
  const held = { buttons: 1 };

  it('starts at once on a press on the pin, and the camera never hears that press', () => {
    const { element, state, requests, down } = grabbed();
    const heardByTheCamera = vi.fn();
    element.addEventListener('pointerdown', heardByTheCamera);

    down(100, 100);

    expect(state.pinChecks).toEqual([{ x: 100, y: 100 }]);
    expect(heardByTheCamera).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('holds the pointer, and gives it back at the end', () => {
    const { element, requests, down, up } = grabbed();
    element.setPointerCapture = vi.fn();
    element.releasePointerCapture = vi.fn();

    down(100, 100);
    expect(element.setPointerCapture).toHaveBeenCalledWith(1);
    up(100, 100);
    reply(requests, place(1, 0, 2));

    expect(element.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('shows the pin at the place under each move, and only at a place', () => {
    const { actions, requests, down, move } = grabbed();
    down(100, 100);

    move(110, 100, held);
    expect(requests.at(-1)!.point).toEqual({ x: 110, y: 100 });
    reply(requests, place(4, 0, 5));
    move(120, 100, held);
    reply(requests, asset('CT-01'));
    move(130, 100, held);
    reply(requests, null);

    expect(actions.previewPin).toHaveBeenCalledExactlyOnceWith([4, 0, 5]);
  });

  it('drops the pin at the place under the release, asking once more', () => {
    const { actions, requests, down, move, up } = grabbed();
    down(100, 100);
    move(110, 100, held);
    reply(requests, place(4, 0, 5));

    up(140, 100);
    expect(requests.at(-1)!.point).toEqual({ x: 140, y: 100 });
    reply(requests, place(8, 12, 9));

    expect(actions.dropPin).toHaveBeenCalledExactlyOnceWith([8, 12, 9]);
    // A drag of the pin is not a click: nothing is placed or selected by it.
    expect(actions.placePin).not.toHaveBeenCalled();
    expect(actions.toggleAsset).not.toHaveBeenCalled();
  });

  it('drops it at the last place shown when the ray at the release finds nothing', () => {
    const { actions, requests, down, move, up } = grabbed();
    down(100, 100);
    move(110, 100, held);
    reply(requests, place(4, 0, 5));

    up(140, 100);
    reply(requests, null);

    expect(actions.dropPin).toHaveBeenCalledExactlyOnceWith([4, 0, 5]);
  });

  it('drops it nowhere when nothing was ever shown and the ray finds nothing', () => {
    const { actions, requests, down, up } = grabbed();
    down(100, 100);

    up(100, 100);
    reply(requests, null);

    expect(actions.dropPin).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('is not cancelled by a move that comes after the release and before its answer', () => {
    const { actions, requests, down, up, move } = grabbed();
    down(100, 100);
    up(140, 100);

    move(141, 100, { buttons: 0 });
    reply(requests, place(8, 12, 9));

    expect(actions.dropPin).toHaveBeenCalledExactlyOnceWith([8, 12, 9]);
  });

  it('asks for no hover while it is held, and none after', () => {
    const { requests, down, move, up } = grabbed();
    down(100, 100);
    move(110, 100, held);
    const asked = requests.length;
    up(110, 100);
    reply(requests, place(1, 0, 1));

    move(200, 200);

    expect(requests.length).toBe(asked + 1);
  });

  it('lets the pin go where it started when a second pointer goes down (a pinch)', () => {
    const { actions, down } = grabbed();
    down(100, 100);

    down(150, 100, { pointerId: 2, pointerType: 'touch' });

    expect(actions.dropPin).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('lets it go where it started when the browser cancels the pointer', () => {
    const { actions, down } = grabbed();
    down(100, 100);

    fireEvent.pointerCancel(document.body, { pointerId: 1 });

    expect(actions.dropPin).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('lets it go where it started when a release was missed: a move with no button down', () => {
    const { actions, down, move } = grabbed();
    down(100, 100);

    move(120, 100, { buttons: 0 });

    expect(actions.dropPin).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('lets it go when the pointer controller is taken away mid-drag', () => {
    const { actions, handle, down } = grabbed();
    down(100, 100);

    handle.detach();

    expect(actions.dropPin).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('is only for the primary button', () => {
    const { actions, element, state, down } = grabbed();
    const heardByTheCamera = vi.fn();
    element.addEventListener('pointerdown', heardByTheCamera);

    down(100, 100, { button: 2 });

    expect(state.pinChecks).toEqual([]);
    expect(heardByTheCamera).toHaveBeenCalledTimes(1);
    expect(actions.dropPin).not.toHaveBeenCalled();
  });

  it('is a plain press when the pin is not under the pointer: the camera hears it and a click places the pin', () => {
    const { actions, element, state, down, up, answer } = grabbed();
    state.pin = false;
    const heardByTheCamera = vi.fn();
    element.addEventListener('pointerdown', heardByTheCamera);

    down(100, 100);
    up(100, 100);
    answer(place(3, 0, 3));

    expect(heardByTheCamera).toHaveBeenCalledTimes(1);
    expect(actions.placePin).toHaveBeenCalledWith([3, 0, 3]);
    expect(actions.dropPin).not.toHaveBeenCalled();
  });

  it('is not looked for when no location is picked: the press is the camera’s or a click', () => {
    const { actions, element, state, down, up, answer } = setup();
    state.pin = true;
    const heardByTheCamera = vi.fn();
    element.addEventListener('pointerdown', heardByTheCamera);

    down(100, 100);
    up(100, 100);
    answer(asset('CT-01'));

    expect(state.pinChecks).toEqual([]);
    expect(heardByTheCamera).toHaveBeenCalledTimes(1);
    expect(actions.toggleAsset).toHaveBeenCalled();
    expect(actions.dropPin).not.toHaveBeenCalled();
  });

  it('keeps the crosshair while it is held', () => {
    const { element, handle, down } = grabbed();
    handle.refresh();
    down(100, 100);

    expect(element.style.cursor).toBe('crosshair');
  });
});

describe('hover', () => {
  it('asks for the pick at the pointer, relative to the canvas', () => {
    const { requests, move } = setup();

    move(100, 100);

    expect(requests).toEqual([{ point: { x: 100, y: 100 }, done: undefined }]);
  });

  it('writes the hovered asset', () => {
    const { actions, move, answer } = setup();

    move(100, 100);
    answer(asset('CT-01'));

    expect(actions.hoverAsset).toHaveBeenCalledWith('CT-01');
    expect(actions.hoverPart).not.toHaveBeenCalled();
  });

  it('writes both the part and its asset for a part', () => {
    const { actions, move, answer } = setup({ assetCode: 'CT-01' });

    move(100, 100);
    answer(part('FanBlade', 'CT-01'));

    expect(actions.hoverAsset).toHaveBeenCalledWith('CT-01');
    expect(actions.hoverPart).toHaveBeenCalledWith('FanBlade');
  });

  it('takes back what it wrote when the pointer moves to a building, a camera or nothing', () => {
    const { actions, move, answer } = setup({ assetCode: 'CT-01' });
    move(100, 100);
    answer(part('FanBlade', 'CT-01'));

    answer(building('BLD-DC'));

    expect(actions.hoverAsset).toHaveBeenLastCalledWith(null);
    expect(actions.hoverPart).toHaveBeenLastCalledWith(null);
  });

  it('writes no hover for a beacon, and takes back the asset hover it wrote (V2-16.4)', () => {
    const { actions, move, answer } = setup();
    move(100, 100);
    answer(asset('CT-01'));
    actions.hoverAsset.mockClear();

    answer(beacon('inc-1'));

    expect(actions.hoverAsset).toHaveBeenCalledTimes(1);
    expect(actions.hoverAsset).toHaveBeenLastCalledWith(null);
    expect(actions.hoverPart).not.toHaveBeenCalled();
    expect(actions.selectIncident).not.toHaveBeenCalled();
  });

  it('clears nothing it did not write', () => {
    const { actions, move, answer } = setup();
    move(100, 100);

    answer(null);
    answer(building('BLD-DC'));

    expect(actions.hoverAsset).not.toHaveBeenCalled();
    expect(actions.hoverPart).not.toHaveBeenCalled();
  });

  it('takes back what it wrote when the pointer leaves the canvas, and only that', () => {
    const { element, actions, move, answer } = setup();
    move(100, 100);
    answer(asset('CT-01'));

    fireEvent.pointerLeave(element, { pointerType: 'mouse' });

    expect(actions.hoverAsset).toHaveBeenLastCalledWith(null);
    expect(actions.hoverPart).not.toHaveBeenCalled();
  });

  it('leaves a hover the Assets list set when the pointer leaves without ever hovering', () => {
    const { element, actions, move } = setup();
    move(100, 100);

    fireEvent.pointerLeave(element, { pointerType: 'mouse' });

    expect(actions.hoverAsset).not.toHaveBeenCalled();
  });

  it('asks for nothing while a button is down', () => {
    const { requests, down, move } = setup();

    down(100, 100);
    move(120, 120, { buttons: 1 });

    expect(requests).toEqual([]);
  });

  it('asks for nothing on a touch screen', () => {
    const { requests, move } = setup();

    move(100, 100, { pointerType: 'touch' });

    expect(requests).toEqual([]);
  });

  it('asks for nothing while a report location is picked', () => {
    const { requests, state, move } = setup();
    state.picking = true;

    move(100, 100);

    expect(requests).toEqual([]);
  });

  it('asks for nothing while a click waits for its answer, and again after it', () => {
    const { requests, down, up, move, answer } = setup();
    down(100, 100);
    up(100, 100);
    expect(requests).toHaveLength(1);

    move(101, 100);
    expect(requests).toHaveLength(1);

    answer(null);
    move(102, 100);
    expect(requests).toHaveLength(2);
  });
});

describe('the cursor', () => {
  it('is grab over nothing, pointer over a target, grabbing in a drag and crosshair while picking', () => {
    const { element, state, handle, down, move, up, answer } = setup();
    expect(element.style.cursor).toBe('grab');

    move(100, 100);
    answer(asset('CT-01'));
    expect(element.style.cursor).toBe('pointer');

    down(100, 100);
    move(120, 100, { buttons: 1 });
    expect(element.style.cursor).toBe('grabbing');
    up(120, 100);
    expect(element.style.cursor).toBe('pointer');

    state.picking = true;
    handle.refresh();
    expect(element.style.cursor).toBe('crosshair');
  });

  it('is a pointer over a beacon', () => {
    const { element, move, answer } = setup();
    move(100, 100);

    answer(beacon('inc-1'));

    expect(element.style.cursor).toBe('pointer');
  });

  it('stays a pointer for a press that has not moved past the slop', () => {
    const { element, move, down, answer } = setup();
    move(100, 100);
    answer(asset('CT-01'));

    down(100, 100);
    move(102, 100, { buttons: 1 });

    expect(element.style.cursor).toBe('pointer');
  });

  it('is grabbing for a press that is not the left button, once it has moved', () => {
    const { element, down, move } = setup();

    down(100, 100, { button: 2, buttons: 2 });
    move(130, 100, { buttons: 2 });

    expect(element.style.cursor).toBe('grabbing');
  });
});

describe('detach', () => {
  it('removes every listener, takes back its hover and resets the cursor', () => {
    const { element, actions, requests, handle, move, down, up, answer, unsubscribed } = setup();
    move(100, 100);
    answer(asset('CT-01'));

    handle.detach();
    move(100, 100);
    down(100, 100);
    up(100, 100);

    expect(actions.hoverAsset).toHaveBeenLastCalledWith(null);
    expect(requests).toHaveLength(1);
    expect(element.style.cursor).toBe('');
    expect(unsubscribed()).toBe(true);
  });
});
