#!/usr/bin/env node
// Lightweight smoke placeholder: full local queue execution is covered by Vitest
// D1 integration tests. This script exists so the queue spec's command surface
// is stable for CI/operators.
import { spawnSync } from 'node:child_process';
const result = spawnSync('npx', ['vitest', 'run', 'test/enrichment-queue.test.ts', 'test/pipeline-jobs.test.ts'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
