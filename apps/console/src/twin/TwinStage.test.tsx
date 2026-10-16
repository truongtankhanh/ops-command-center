import { render, screen } from '@testing-library/react';
import TwinStage from './TwinStage';

// R3F's canvas needs WebGL, which jsdom does not have; the stage's job here is to mount it.
vi.mock('./TwinCanvas', () => ({ TwinCanvas: () => <canvas aria-label="3D canvas" /> }));

describe('TwinStage', () => {
  it('mounts the canvas', () => {
    render(<TwinStage />);

    expect(screen.getByLabelText('3D canvas')).toBeInTheDocument();
  });
});
