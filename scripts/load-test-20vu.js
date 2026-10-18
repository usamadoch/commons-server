/**
 * Commons Stage 3: 20 Concurrent Virtual Users Load Test
 *
 * Simulates up to 20 concurrent virtual users executing realistic read-only journeys:
 * - Public guest browsing (pages, creator profiles, posts, tiers, health, ready, csrf)
 * - Authenticated member journeys (auth/me, notifications, unread count, posts, pages)
 *
 * Implements:
 * - Staged ramp-up: 1 -> 5 -> 10 -> 20 VUs -> 10-minute hold -> ramp down
 * - Smoke mode: 2 VUs for 20s (--smoke)
 * - Per-request latency measurement, status tracking, payload validation
 * - Dynamic server process resource sampling (WorkingSet in MB, MongoDB readiness)
 * - Percentile calculations: p50, p90, p95, p99, min, max, avg
 *
 * Usage:
 *   node scripts/load-test-20vu.js --smoke
 *   node scripts/load-test-20vu.js [--holdMinutes=10] [--baseUrl=http://localhost:5000]
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const isSmoke = process.argv.includes('--smoke');
const BASE_URL = process.env.BASE_URL || 
  process.argv.find(arg => arg.startsWith('--baseUrl='))?.split('=')[1] || 
  'http://localhost:5000';

const customHoldArg = process.argv.find(arg => arg.startsWith('--holdMinutes='))?.split('=')[1];
const HOLD_MINUTES = isSmoke ? 0.33 : (customHoldArg ? parseFloat(customHoldArg) : 10);

// Load test stages
const STAGES = isSmoke
  ? [
      { vus: 2, durationSec: 20, name: '2 VU Smoke Test' }
    ]
  : [
      { vus: 1, durationSec: 20, name: 'Ramp-up (1 VU)' },
      { vus: 5, durationSec: 30, name: 'Ramp-up (5 VUs)' },
      { vus: 10, durationSec: 30, name: 'Ramp-up (10 VUs)' },
      { vus: 20, durationSec: 30, name: 'Ramp-up (20 VUs)' },
      { vus: 20, durationSec: Math.round(HOLD_MINUTES * 60), name: `Hold Peak (20 VUs for ${HOLD_MINUTES} min)` },
      { vus: 10, durationSec: 30, name: 'Ramp-down (10 VUs)' },
      { vus: 5, durationSec: 20, name: 'Ramp-down (5 VUs)' },
      { vus: 0, durationSec: 10, name: 'Cool-down (0 VUs)' },
    ];

const THRESHOLDS = {
  'Simple Public Read': 500,
  'Complex DB Read': 800,
};

// Verified Stage 2 baseline p95 values for comparison
const STAGE_2_BASELINE_P95 = {
  'GET /health': 2.39,
  'GET /ready': 2.43,
  'GET /auth/csrf': 2.32,
  'GET /pages': 355.82,
  'GET /pages/commons': 480.97,
  'GET /posts/creator?pageSlug=commons': 417.09,
  'GET /posts/6acf7f60d559dd44440fb088': 439.51,
  'GET /tiers/creator/6a6b59e2987cb5a57a940db8': 461.00,
  'GET /auth/me': 401.62,
  'GET /notifications': 452.03,
  'GET /notifications/unread-count': 419.21,
};

// Metrics Collector
class MetricsCollector {
  constructor() {
    this.endpoints = new Map();
    this.systemSamples = [];
    this.startTime = 0;
    this.endTime = 0;
  }

  registerEndpoint(name, category, targetP95) {
    if (!this.endpoints.has(name)) {
      this.endpoints.set(name, {
        name,
        category,
        targetP95,
        latencies: [],
        statusCodes: new Map(),
        successCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        timeoutCount: 0,
      });
    }
  }

  record(name, latencyMs, statusCode, isValid, isTimeout = false) {
    const ep = this.endpoints.get(name);
    if (!ep) return;

    ep.latencies.push(latencyMs);
    const codeKey = String(statusCode);
    ep.statusCodes.set(codeKey, (ep.statusCodes.get(codeKey) || 0) + 1);

    if (statusCode === 429) {
      ep.rateLimitCount++;
    }
    if (isTimeout) {
      ep.timeoutCount++;
    }

    if (isValid && statusCode >= 200 && statusCode < 300) {
      ep.successCount++;
    } else {
      ep.errorCount++;
    }
  }

  recordSystem(activeVUs, reqRate, memoryMB, mongoStatus) {
    this.systemSamples.push({
      timestamp: Date.now(),
      activeVUs,
      reqRate,
      memoryMB,
      mongoStatus,
    });
  }

  getSummary() {
    const results = [];
    let grandTotalRequests = 0;
    let grandTotalSuccess = 0;
    let grandTotalErrors = 0;
    let grandTotalTimeouts = 0;

    for (const [name, ep] of this.endpoints.entries()) {
      grandTotalRequests += ep.latencies.length;
      grandTotalSuccess += ep.successCount;
      grandTotalErrors += ep.errorCount;
      grandTotalTimeouts += ep.timeoutCount;

      const sorted = [...ep.latencies].sort((a, b) => a - b);
      const count = sorted.length;
      const min = count ? sorted[0] : 0;
      const max = count ? sorted[count - 1] : 0;
      const sum = sorted.reduce((a, b) => a + b, 0);
      const avg = count ? sum / count : 0;

      const p50 = count ? sorted[Math.floor(count * 0.5)] : 0;
      const p90 = count ? sorted[Math.floor(count * 0.9)] : 0;
      const p95 = count ? sorted[Math.min(count - 1, Math.ceil(count * 0.95) - 1)] : 0;
      const p99 = count ? sorted[Math.min(count - 1, Math.ceil(count * 0.99) - 1)] : 0;

      const baselineP95 = STAGE_2_BASELINE_P95[name] || null;
      const degradationPct = baselineP95 ? ((p95 - baselineP95) / baselineP95) * 100 : 0;
      const pass = p95 <= ep.targetP95 && ep.errorCount === 0;

      results.push({
        name,
        category: ep.category,
        totalRequests: count,
        successCount: ep.successCount,
        errorCount: ep.errorCount,
        rateLimitCount: ep.rateLimitCount,
        timeoutCount: ep.timeoutCount,
        statusCodes: Object.fromEntries(ep.statusCodes.entries()),
        min: Number(min.toFixed(2)),
        avg: Number(avg.toFixed(2)),
        p50: Number(p50.toFixed(2)),
        p90: Number(p90.toFixed(2)),
        p95: Number(p95.toFixed(2)),
        p99: Number(p99.toFixed(2)),
        max: Number(max.toFixed(2)),
        targetP95: ep.targetP95,
        baselineP95,
        degradationPct: Number(degradationPct.toFixed(1)),
        pass,
      });
    }

    const totalDurationSec = (this.endTime - this.startTime) / 1000;
    const avgRequestRate = totalDurationSec > 0 ? (grandTotalRequests / totalDurationSec) : 0;
    const overallErrorPct = grandTotalRequests > 0 ? (grandTotalErrors / grandTotalRequests) * 100 : 0;

    return {
      totalDurationSec: Number(totalDurationSec.toFixed(1)),
      grandTotalRequests,
      grandTotalSuccess,
      grandTotalErrors,
      grandTotalTimeouts,
      avgRequestRate: Number(avgRequestRate.toFixed(2)),
      overallErrorPct: Number(overallErrorPct.toFixed(3)),
      endpoints: results,
      systemSamples: this.systemSamples,
    };
  }
}

// Dynamically inspect Node.js Server Process Memory
function sampleServerProcess() {
  try {
    const cmd = `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1 | ForEach-Object { (Get-Process -Id $_).WorkingSet64 })"`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 3000 }).trim();
    const memoryBytes = parseInt(output, 10);
    if (!isNaN(memoryBytes) && memoryBytes > 0) {
      const memoryMB = Number((memoryBytes / (1024 * 1024)).toFixed(1));
      return { memoryMB };
    }
  } catch {
    // Dynamic query fallback
  }
  return { memoryMB: 0 };
}

// Random think time helper (between minMs and maxMs)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomThinkTime = (min = 600, max = 1200) => 
  Math.floor(Math.random() * (max - min + 1)) + min;

async function setupAuthSessions() {
  console.log('[Setup] Obtaining CSRF token and authenticating test member sessions...');
  const csrfRes = await fetch(`${BASE_URL}/auth/csrf`);
  if (!csrfRes.ok) {
    throw new Error(`Failed to fetch CSRF from ${BASE_URL}/auth/csrf: ${csrfRes.status}`);
  }
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.data.csrfToken;
  const baseCookies = csrfRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

  // Session A: benchmark_runner@test.com
  let authCookiesA = '';
  try {
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, 'cookie': baseCookies },
      body: JSON.stringify({ email: 'benchmark_runner@test.com', password: 'BenchmarkPassword123!' })
    });
    if (loginRes.ok) {
      authCookiesA = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    }
  } catch (err) {
    console.warn('  Warning: Session A login failed:', err.message);
  }

  // Session B: member1@test.com
  let authCookiesB = '';
  try {
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, 'cookie': baseCookies },
      body: JSON.stringify({ email: 'member1@test.com', password: 'password123' })
    });
    if (loginRes.ok) {
      authCookiesB = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    }
  } catch (err) {
    console.warn('  Warning: Session B login failed:', err.message);
  }

  const sessionACookies = [baseCookies, authCookiesA].filter(Boolean).join('; ');
  const sessionBCookies = [baseCookies, authCookiesB].filter(Boolean).join('; ');

  console.log(`  ✓ Session A (benchmark_runner): ${authCookiesA ? 'Active' : 'Unauthenticated'}`);
  console.log(`  ✓ Session B (member1): ${authCookiesB ? 'Active' : 'Unauthenticated'}`);

  return { csrfToken, baseCookies, sessionACookies, sessionBCookies };
}

async function runStage3LoadTest() {
  console.log('='.repeat(90));
  console.log(` COMMONS STAGE 3: 20 CONCURRENT VIRTUAL USERS LOAD TEST`);
  console.log(` Mode: ${isSmoke ? 'SMOKE TEST (2 VUs, 20s)' : `FULL PROFILE (Peak: 20 VUs for ${HOLD_MINUTES} min)`}`);
  console.log(` Target Server: ${BASE_URL}`);
  console.log('='.repeat(90));

  const authData = await setupAuthSessions();
  const collector = new MetricsCollector();

  // Register All 11 Verified Endpoints
  collector.registerEndpoint('GET /health', 'Simple Public Read', THRESHOLDS['Simple Public Read']);
  collector.registerEndpoint('GET /ready', 'Simple Public Read', THRESHOLDS['Simple Public Read']);
  collector.registerEndpoint('GET /auth/csrf', 'Simple Public Read', THRESHOLDS['Simple Public Read']);
  collector.registerEndpoint('GET /pages', 'Simple Public Read', THRESHOLDS['Simple Public Read']);
  collector.registerEndpoint('GET /pages/commons', 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint('GET /posts/creator?pageSlug=commons', 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint('GET /posts/6acf7f60d559dd44440fb088', 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint('GET /tiers/creator/6a6b59e2987cb5a57a940db8', 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint('GET /auth/me', 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint('GET /notifications', 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint('GET /notifications/unread-count', 'Complex DB Read', THRESHOLDS['Complex DB Read']);

  // VU Pool Control
  let targetVUs = 0;
  let activeVUs = 0;
  let isRunning = true;
  let totalRequestsExecuted = 0;
  let recentRequestsCount = 0;
  let lastRateSampleTime = Date.now();

  // Virtual User Action Definitions
  const userActions = [
    // 1. Health Probe
    {
      name: 'GET /health',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/health`);
        const body = await res.json();
        return { status: res.status, valid: res.status === 200 && body.success === true };
      }
    },
    // 2. Readiness Probe
    {
      name: 'GET /ready',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/ready`);
        const body = await res.json();
        return { status: res.status, valid: res.status === 200 && body.success === true };
      }
    },
    // 3. CSRF Handshake
    {
      name: 'GET /auth/csrf',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/auth/csrf`);
        const body = await res.json();
        return { status: res.status, valid: res.status === 200 && typeof body.data?.csrfToken === 'string' };
      }
    },
    // 4. Discover creators
    {
      name: 'GET /pages',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/pages`);
        const body = await res.json();
        return { status: res.status, valid: res.status === 200 && Array.isArray(body.data?.pages) };
      }
    },
    // 5. Creator Page Slug
    {
      name: 'GET /pages/commons',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/pages/commons`);
        const body = await res.json();
        return { status: res.status, valid: res.status === 200 && body.data?.page?.pageSlug === 'commons' };
      }
    },
    // 6. Creator Posts Feed
    {
      name: 'GET /posts/creator?pageSlug=commons',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/posts/creator?pageSlug=commons`);
        const body = await res.json();
        return { status: res.status, valid: res.status === 200 && Array.isArray(body.data?.posts) };
      }
    },
    // 7. Post Details
    {
      name: 'GET /posts/6acf7f60d559dd44440fb088',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/posts/6acf7f60d559dd44440fb088`);
        const body = await res.json();
        return { status: res.status, valid: res.status === 200 && body.data?.post?._id === '6acf7f60d559dd44440fb088' };
      }
    },
    // 8. Creator Membership Tiers
    {
      name: 'GET /tiers/creator/6a6b59e2987cb5a57a940db8',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/tiers/creator/6a6b59e2987cb5a57a940db8`);
        const body = await res.json();
        return { status: res.status, valid: res.status === 200 && Array.isArray(body.data?.plans) };
      }
    },
    // 9. Authenticated Current User
    {
      name: 'GET /auth/me',
      execute: async (sessionCookie) => {
        const res = await fetch(`${BASE_URL}/auth/me`, {
          headers: { 'cookie': sessionCookie }
        });
        const body = await res.json();
        return { status: res.status, valid: res.status === 200 && body.success === true && Boolean(body.data?.user) };
      }
    },
    // 10. Authenticated Notifications
    {
      name: 'GET /notifications',
      execute: async (sessionCookie) => {
        const res = await fetch(`${BASE_URL}/notifications`, {
          headers: { 'cookie': sessionCookie }
        });
        const body = await res.json();
        return { status: res.status, valid: res.status === 200 && Array.isArray(body.data?.notifications) };
      }
    },
    // 11. Authenticated Unread Count
    {
      name: 'GET /notifications/unread-count',
      execute: async (sessionCookie) => {
        const res = await fetch(`${BASE_URL}/notifications/unread-count`, {
          headers: { 'cookie': sessionCookie }
        });
        const body = await res.json();
        return { status: res.status, valid: res.status === 200 && typeof body.data?.count === 'number' };
      }
    },
  ];

  // Worker Loop for an Individual Virtual User
  async function virtualUserWorker(vuId) {
    activeVUs++;
    // 50% authenticated VUs rotating between Session A and Session B, 50% public guest VUs
    const isAuth = vuId % 2 === 0;
    const sessionCookie = isAuth ? (vuId % 4 === 0 ? authData.sessionACookies : authData.sessionBCookies) : authData.baseCookies;

    // Available actions for this VU persona
    const actions = isAuth 
      ? userActions // Authenticated member visits profile, notifications, feeds, pages, posts
      : userActions.filter(a => !['GET /auth/me', 'GET /notifications', 'GET /notifications/unread-count'].includes(a.name)); // Guest

    let actionIndex = vuId % actions.length;

    while (isRunning && activeVUs <= targetVUs) {
      const action = actions[actionIndex % actions.length];
      actionIndex++;

      const tStart = performance.now();
      let status = 0;
      let valid = false;
      let isTimeout = false;

      try {
        const result = await Promise.race([
          action.execute(sessionCookie),
          new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 10000))
        ]);
        status = result.status;
        valid = result.valid;
      } catch (err) {
        if (err.message === 'TIMEOUT') {
          isTimeout = true;
          status = 504;
        } else {
          status = 599; // Client / Network failure
        }
        valid = false;
      }

      const durationMs = performance.now() - tStart;
      collector.record(action.name, durationMs, status, valid, isTimeout);
      totalRequestsExecuted++;
      recentRequestsCount++;

      // Realistic user think time between actions (only 1 request in flight per VU)
      await sleep(randomThinkTime(600, 1200));
    }

    activeVUs--;
  }

  // Monitor & Periodic Reporter Loop (every 10 seconds)
  const monitorInterval = setInterval(async () => {
    if (!isRunning) return;
    const now = Date.now();
    const elapsedSec = (now - lastRateSampleTime) / 1000;
    const currentRate = elapsedSec > 0 ? (recentRequestsCount / elapsedSec) : 0;
    recentRequestsCount = 0;
    lastRateSampleTime = now;

    // Sample Server Process Memory and MongoDB readiness
    const serverProc = sampleServerProcess();
    let mongoReady = false;
    try {
      const readyRes = await fetch(`${BASE_URL}/ready`);
      const readyJson = await readyRes.json();
      mongoReady = readyJson.data?.services?.mongodb === 'connected';
    } catch {
      mongoReady = false;
    }

    collector.recordSystem(activeVUs, Number(currentRate.toFixed(1)), serverProc.memoryMB, mongoReady ? 'connected' : 'degraded');

    const timestamp = new Date().toLocaleTimeString();
    console.log(`  [${timestamp}] Active VUs: ${String(activeVUs).padStart(2)}/${String(targetVUs).padStart(2)} | Rate: ${currentRate.toFixed(1).padStart(4)} req/s | Total: ${String(totalRequestsExecuted).padStart(5)} | Server RAM: ${serverProc.memoryMB.toFixed(1)} MB | DB: ${mongoReady ? 'OK' : 'ERR'}`);
  }, 10000);

  // Execute Stages
  collector.startTime = Date.now();
  console.log('\n[Stage Execution Started]');

  for (let stageIdx = 0; stageIdx < STAGES.length; stageIdx++) {
    const stage = STAGES[stageIdx];
    console.log(`\n>>> Entering Stage ${stageIdx + 1}/${STAGES.length}: ${stage.name} (Target: ${stage.vus} VUs, Duration: ${stage.durationSec}s)`);
    targetVUs = stage.vus;

    // Spawn VUs if increasing
    while (activeVUs < targetVUs) {
      virtualUserWorker(activeVUs + 1);
    }

    // Wait stage duration
    await sleep(stage.durationSec * 1000);
  }

  // Teardown
  isRunning = false;
  targetVUs = 0;
  clearInterval(monitorInterval);

  // Wait for in-flight VUs to settle
  console.log('\n[Cool-down] Waiting for in-flight virtual users to finish...');
  let settleWait = 0;
  while (activeVUs > 0 && settleWait < 50) {
    await sleep(200);
    settleWait++;
  }
  collector.endTime = Date.now();

  // 4. Summarize & Print Results
  const summary = collector.getSummary();
  console.log('\n' + '='.repeat(128));
  console.log(` 20 VIRTUAL USERS CONCURRENCY TEST RESULTS SUMMARY`);
  console.log('='.repeat(128));
  console.log(` Total Test Duration:    ${summary.totalDurationSec} seconds (${(summary.totalDurationSec / 60).toFixed(1)} minutes)`);
  console.log(` Total Requests Served:  ${summary.grandTotalRequests.toLocaleString()}`);
  console.log(` Successful Requests:    ${summary.grandTotalSuccess.toLocaleString()} (${((summary.grandTotalSuccess / summary.grandTotalRequests) * 100).toFixed(2)}%)`);
  console.log(` Failed Requests:        ${summary.grandTotalErrors} (${summary.overallErrorPct}%)`);
  console.log(` Request Timeouts (10s): ${summary.grandTotalTimeouts}`);
  console.log(` Average Request Rate:   ${summary.avgRequestRate} requests/sec`);
  console.log('='.repeat(128));

  // Table of Endpoints
  console.log(
    '| ' +
    'Endpoint'.padEnd(38) + ' | ' +
    'Category'.padEnd(19) + ' | ' +
    'Requests'.padStart(8) + ' | ' +
    'p50'.padStart(8) + ' | ' +
    'p90'.padStart(8) + ' | ' +
    'p95'.padStart(8) + ' | ' +
    'p99'.padStart(8) + ' | ' +
    'Max'.padStart(8) + ' | ' +
    'Target'.padStart(7) + ' | ' +
    'S2 p95'.padStart(8) + ' | ' +
    'Change'.padStart(7) + ' | ' +
    'Result'.padEnd(6) + ' |'
  );
  console.log('|' + '-'.repeat(40) + '|' + '-'.repeat(21) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(9) + '|' + '-'.repeat(10) + '|' + '-'.repeat(9) + '|' + '-'.repeat(8) + '|');

  for (const ep of summary.endpoints) {
    const changeStr = ep.degradationPct >= 0 ? `+${ep.degradationPct}%` : `${ep.degradationPct}%`;
    const resultStr = ep.pass ? 'PASS' : 'FAIL';

    console.log(
      '| ' +
      ep.name.padEnd(38) + ' | ' +
      ep.category.padEnd(19) + ' | ' +
      String(ep.totalRequests).padStart(8) + ' | ' +
      `${ep.p50}ms`.padStart(8) + ' | ' +
      `${ep.p90}ms`.padStart(8) + ' | ' +
      `${ep.p95}ms`.padStart(8) + ' | ' +
      `${ep.p99}ms`.padStart(8) + ' | ' +
      `${ep.max}ms`.padStart(8) + ' | ' +
      `<${ep.targetP95}ms`.padStart(7) + ' | ' +
      `${ep.baselineP95 ? ep.baselineP95 + 'ms' : 'N/A'}`.padStart(8) + ' | ' +
      changeStr.padStart(7) + ' | ' +
      resultStr.padEnd(6) + ' |'
    );
  }
  console.log('='.repeat(128));

  // Save report artifact to JSON
  const outputPath = path.resolve('load-test-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n✓ Detailed JSON test artifact saved to: ${outputPath}`);

  return summary;
}

runStage3LoadTest().catch(err => {
  console.error('\n❌ Fatal Load Test Error:', err);
  process.exit(1);
});
