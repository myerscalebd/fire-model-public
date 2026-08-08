/// <reference lib="webworker" />
import { handleJob } from "./engineJobs";
import type { EngineJob } from "./engineJobs";

export type { EngineJob as WorkerJob };

self.onmessage = (e: MessageEvent<EngineJob>) => {
  self.postMessage(handleJob(e.data));
};
