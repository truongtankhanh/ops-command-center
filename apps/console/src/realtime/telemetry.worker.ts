import { createTelemetryEngine } from './telemetryEngine';
import { isToWorker } from './telemetryProtocol';

/**
 * Entry of the telemetry worker (ADR-0019, ADR-0020 § State). It owns no logic: the engine holds
 * all of it and is the same code the main thread runs where there is no `Worker`. Anything that is
 * not a message of this protocol version is ignored.
 */
const engine = createTelemetryEngine({
  host: { post: (message, transfer) => self.postMessage(message, { transfer }) },
});

self.addEventListener('message', (event: MessageEvent) => {
  if (isToWorker(event.data)) engine.receive(event.data);
});
