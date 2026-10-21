import '@testing-library/jest-dom/vitest';

// jsdom has no canvas. The capability probe (`webgl2Supported`) asks for a WebGL 2 context whenever
// the store is created, and jsdom would print "Not implemented: HTMLCanvasElement.prototype.getContext"
// each time. Answer `null` quietly, as jsdom does; a case that needs a context stubs it (`stubTwinAvailable`).
HTMLCanvasElement.prototype.getContext = () => null;
