// Re-export the global Env type from worker-configuration.d.ts
// All source files import Env from here for consistency.
export type Env = globalThis.Env;
