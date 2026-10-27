/**
 * PDF worker entry. Performs the conservative pdf-lib structural rewrite off
 * the main thread. Protocol: see src/engine/worker-protocol.js.
 */
import { serveTask } from '../engine/worker-host.js';
import { rewritePdf } from '../engine/tasks/pdf-task.js';

serveTask(rewritePdf);
