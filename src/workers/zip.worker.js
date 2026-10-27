/**
 * ZIP worker entry. Builds archives of original payloads with JSZip off the
 * main thread. Protocol: see src/engine/worker-protocol.js.
 */
import { serveTask } from '../engine/worker-host.js';
import { buildZipArchive } from '../engine/tasks/zip-task.js';

serveTask(buildZipArchive);
