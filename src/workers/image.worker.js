/**
 * Image worker entry. Decodes, resizes and orients one image with
 * browser-image-compression's helpers on an OffscreenCanvas, then encodes it
 * with the WebAssembly encoders in tasks/codecs.js and checks the result. The
 * library's own nested-worker mode (which would load a copy of itself from a
 * CDN) is never used. Protocol: see src/engine/worker-protocol.js.
 */
import { serveTask } from '../engine/worker-host.js';
import { compressImage } from '../engine/tasks/image-task.js';

serveTask(compressImage);
