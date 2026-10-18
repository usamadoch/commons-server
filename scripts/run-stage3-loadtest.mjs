/**
 * Commons Stage 3: 20 Concurrent Virtual Users Load Test (Oregon Target)
 *
 * Simulates 20 concurrent virtual users holding peak load for 10 continuous minutes
 * against the deployed Oregon Render backend (https://api.commons.pk) and Oregon MongoDB Atlas.
 *
 * User Journey Mix:
 * - 10 Public Guest VUs: /pages, /pages/commons, /posts/creator, /posts/:id, /tiers/creator, /health, /ready, /auth/csrf
 * - 5 Authenticated Member VUs: /auth/me, /notifications, /notifications/unread-count, /pages/commons, /posts/creator
 * - 5 Authenticated Creator VUs: /auth/me, /notifications, /notifications/unread-count, /posts/:id, /tiers/creator
 *
 * Pacing:
 * - Think time 12-16s per action per VU ensures ~80-86 req/min overall
 * - Prevents single-IP rate limit ceiling distortion (100 req/min) while sustaining continuous 20 VU concurrency
 */

import fs from 'fs';
import path from 'path';

const isSmoke = process.argv.includes('--smoke');
const BASE_URL = process.env.BASE_URL || 'https://api.commons.pk';
const customHoldArg = process.argv.find(arg => arg.startsWith('--holdMinutes='))?.split('=')[1];
const HOLD_MINUTES = isSmoke ? 0.33 : (customHoldArg ? parseFloat(customHoldArg) : 10);

const STAGES = isSmoke
  ? [
      { vus: 2, durationSec: 20, name: 'Smoke Test (2 VUs, 20s)' }
    ]
  : [
      { vus: 1, durationSec: 15, name: 'Ramp-up (1 VU)' },
      { vus: 5, durationSec: 20, name: 'Ramp-up (5 VUs)' },
      { vus: 10, durationSec: 25, name: 'Ramp-up (10 VUs)' },
      { vus: 20, durationSec: 30, name: 'Ramp-up (20 VUs)' },
      { vus: 20, durationSec: Math.round(HOLD_MINUTES * 60), name: `Hold Peak (20 VUs for ${HOLD_MINUTES} min)` },
      { vus: 10, durationSec: 20, name: 'Ramp-down (10 VUs)' },
      { vus: 5, durationSec: 15, name: 'Ramp-down (5 VUs)' },
      { vus: 0, durationSec: 10, name: 'Cool-down (0 VUs)' },
    ];

const THRESHOLDS = {
  'Simple Public Read': 500,
  'Complex DB Read': 800,
};

// Verified Oregon fixtures
const OREGON_PAGE_SLUG = 'commons';
const OREGON_POST_ID = '6ab670e11d78868df779cf94';
const OREGON_CREATOR_ID = '6a4ab792301861fbab5f22c8';

// Stage 2 baseline p95 for comparison
const BASELINE_P95 = {
  'GET /health': 346.6,
  'GET /ready': 353.3,
  'GET /auth/csrf': 350.0,
  'GET /pages': 560.6,
  'GET /pages/commons': 640.2,
  'GET /posts/creator?pageSlug=commons': 595.4,
  'GET /posts/:id': 580.0,
  'GET /tiers/creator/:id': 510.5,
  'GET /auth/me': 480.0,
  'GET /notifications': 520.0,
  'GET /notifications/unread-count': 490.0,
};

class MetricsCollector {
  constructor() {
    this.endpoints = new Map();
    this.timeSeries = [];
    this.startTime = 0;
    this.endTime = 0;
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.total429 = 0;
    this.totalTimeouts = 0;
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
        errorSamples: [],
      });
    }
  }

  record(name, latencyMs, statusCode, isValid, isTimeout = false, errorDetail = null) {
    const ep = this.endpoints.get(name);
    if (!ep) return;

    ep.latencies.push(latencyMs);
    const codeKey = String(statusCode);
    ep.statusCodes.set(codeKey, (ep.statusCodes.get(codeKey) || 0) + 1);

    this.totalRequests++;

    if (statusCode === 429) {
      ep.rateLimitCount++;
      this.total429++;
    }
    if (isTimeout) {
      ep.timeoutCount++;
      this.totalTimeouts++;
    }

    if (isValid && statusCode >= 200 && statusCode < 300) {
      ep.successCount++;
    } else {
      ep.errorCount++;
      this.totalErrors++;
      if (ep.errorSamples.length < 5) {
        ep.errorSamples.push({
          timestamp: new Date().toISOString(),
          status: statusCode,
          detail: errorDetail || `Status ${statusCode}`
        });
      }
    }
  }

  recordTimeSample(activeVUs, reqRate, avgLatency, mongoStatus, redisStatus) {
    this.timeSeries.push({
      timestamp: Date.now(),
      timeFormatted: new Date().toLocaleTimeString(),
      activeVUs,
      reqRate,
      avgLatency,
      mongoStatus,
      redisStatus,
    });
  }

  getSummary() {
    const results = [];
    let grandTotalRequests = 0;
    let grandTotalSuccess = 0;
    let grandTotalErrors = 0;
    let grandTotal429 = 0;
    let grandTotalTimeouts = 0;

    for (const [name, ep] of this.endpoints.entries()) {
      grandTotalRequests += ep.latencies.length;
      grandTotalSuccess += ep.successCount;
      grandTotalErrors += ep.errorCount;
      grandTotal429 += ep.rateLimitCount;
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

      const baselineKey = Object.keys(BASELINE_P95).find(k => name.startsWith(k.split(':')[0]));
      const baselineP95 = baselineKey ? BASELINE_P95[baselineKey] : null;
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
        errorSamples: ep.errorSamples,
      });
    }

    const totalDurationSec = (this.endTime - this.startTime) / 1000;
    const avgRequestRate = totalDurationSec > 0 ? (grandTotalRequests / totalDurationSec) : 0;
    const overallErrorPct = grandTotalRequests > 0 ? (grandTotalErrors / grandTotalRequests) * 100 : 0;

    return {
      metadata: {
        targetUrl: BASE_URL,
        region: 'Oregon, USA (AWS us-west-2)',
        mongodbRegion: 'Oregon, USA (AWS us-west-2, cluster0.0hhveup)',
        timestamp: new Date().toISOString(),
        totalDurationSec: Number(totalDurationSec.toFixed(1)),
        peakVUs: isSmoke ? 2 : 20,
        holdMinutes: HOLD_MINUTES,
      },
      metrics: {
        totalRequests: grandTotalRequests,
        successRequests: grandTotalSuccess,
        failedRequests: grandTotalErrors,
        rateLimited429: grandTotal429,
        timeouts: grandTotalTimeouts,
        avgRequestRate: Number(avgRequestRate.toFixed(2)),
        overallErrorPct: Number(overallErrorPct.toFixed(2)),
      },
      endpoints: results,
      timeSeries: this.timeSeries,
    };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomThinkTime = (min = 12000, max = 16000) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

async function setupAuthSessions() {
  console.log('[Setup] Initializing CSRF handshake and authenticating member/creator sessions...');
  const csrfRes = await fetch(`${BASE_URL}/auth/csrf`);
  if (!csrfRes.ok) {
    throw new Error(`Failed to fetch CSRF from ${BASE_URL}/auth/csrf: ${csrfRes.status}`);
  }
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.data.csrfToken;
  const baseCookies = csrfRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

  // Member session
  let memberCookies = '';
  try {
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, 'cookie': baseCookies },
      body: JSON.stringify({ email: 'member@commons.pk', password: 'TestPassword123!' })
    });
    if (loginRes.ok) {
      memberCookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
      console.log('  ✓ Member session authenticated: member@commons.pk');
    } else {
      console.warn('  ⚠️ Member login failed:', loginRes.status);
    }
  } catch (err) {
    console.warn('  ⚠️ Member login error:', err.message);
  }

  // Creator session
  let creatorCookies = '';
  try {
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, 'cookie': baseCookies },
      body: JSON.stringify({ email: 'creator@commons.pk', password: 'TestPassword123!' })
    });
    if (loginRes.ok) {
      creatorCookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
      console.log('  ✓ Creator session authenticated: creator@commons.pk');
    } else {
      console.warn('  ⚠️ Creator login failed:', loginRes.status);
    }
  } catch (err) {
    console.warn('  ⚠️ Creator login error:', err.message);
  }

  const fullMemberCookies = [baseCookies, memberCookies].filter(Boolean).join('; ');
  const fullCreatorCookies = [baseCookies, creatorCookies].filter(Boolean).join('; ');

  return { csrfToken, guestCookies: baseCookies, memberCookies: fullMemberCookies, creatorCookies: fullCreatorCookies };
}

async function runStage3LoadTest() {
  console.log('='.repeat(100));
  console.log(` COMMONS STAGE 3: 20 CONCURRENT VIRTUAL USERS LOAD TEST`);
  console.log(` Target Server:   ${BASE_URL} (Render - Oregon, USA)`);
  console.log(` Target Database: MongoDB Atlas (Oregon, USA - us-west-2)`);
  console.log(` Target Cache:    Upstash Redis`);
  console.log(` Test Profile:    ${isSmoke ? 'SMOKE TEST (2 VUs, 20s)' : `FULL PROFILE (Peak: 20 VUs for ${HOLD_MINUTES} continuous minutes)`}`);
  console.log('='.repeat(100));

  const authData = await setupAuthSessions();
  const collector = new MetricsCollector();

  // Register All 11 Endpoints
  collector.registerEndpoint('GET /health', 'Simple Public Read', THRESHOLDS['Simple Public Read']);
  collector.registerEndpoint('GET /ready', 'Simple Public Read', THRESHOLDS['Simple Public Read']);
  collector.registerEndpoint('GET /auth/csrf', 'Simple Public Read', THRESHOLDS['Simple Public Read']);
  collector.registerEndpoint('GET /pages', 'Simple Public Read', THRESHOLDS['Simple Public Read']);
  collector.registerEndpoint('GET /pages/commons', 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint('GET /posts/creator?pageSlug=commons', 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint(`GET /posts/${OREGON_POST_ID}`, 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint(`GET /tiers/creator/${OREGON_CREATOR_ID}`, 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint('GET /auth/me', 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint('GET /notifications', 'Complex DB Read', THRESHOLDS['Complex DB Read']);
  collector.registerEndpoint('GET /notifications/unread-count', 'Complex DB Read', THRESHOLDS['Complex DB Read']);

  // Action definitions
  const actionDefinitions = {
    health: {
      name: 'GET /health',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/health`);
        const json = await res.json().catch(() => null);
        return { status: res.status, valid: res.status === 200 && json?.success === true };
      }
    },
    ready: {
      name: 'GET /ready',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/ready`);
        const json = await res.json().catch(() => null);
        return { status: res.status, valid: res.status === 200 && json?.data?.services?.mongodb === 'connected' };
      }
    },
    csrf: {
      name: 'GET /auth/csrf',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/auth/csrf`);
        const json = await res.json().catch(() => null);
        return { status: res.status, valid: res.status === 200 && typeof json?.data?.csrfToken === 'string' };
      }
    },
    pages: {
      name: 'GET /pages',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/pages`);
        const json = await res.json().catch(() => null);
        return { status: res.status, valid: res.status === 200 && Array.isArray(json?.data?.pages) };
      }
    },
    creatorPage: {
      name: 'GET /pages/commons',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/pages/${OREGON_PAGE_SLUG}`);
        const json = await res.json().catch(() => null);
        return { status: res.status, valid: res.status === 200 && json?.data?.page?.pageSlug === OREGON_PAGE_SLUG };
      }
    },
    creatorPosts: {
      name: 'GET /posts/creator?pageSlug=commons',
      execute: async () => {
        const res = await fetch(`${BASE_URL}/posts/creator?pageSlug=${OREGON_PAGE_SLUG}`);
        const json = await res.json().catch(() => null);
        return { status: res.status, valid: res.status === 200 && Array.isArray(json?.data?.posts) };
      }
    },
    postDetail: {
      name: `GET /posts/${OREGON_POST_ID}`,
      execute: async () => {
        const res = await fetch(`${BASE_URL}/posts/${OREGON_POST_ID}`);
        const json = await res.json().catch(() => null);
        return { status: res.status, valid: res.status === 200 && json?.data?.post?._id === OREGON_POST_ID };
      }
    },
    creatorTiers: {
      name: `GET /tiers/creator/${OREGON_CREATOR_ID}`,
      execute: async () => {
        const res = await fetch(`${BASE_URL}/tiers/creator/${OREGON_CREATOR_ID}`);
        const json = await res.json().catch(() => null);
        return { status: res.status, valid: res.status === 200 && Array.isArray(json?.data?.plans) };
      }
    },
    authMe: {
      name: 'GET /auth/me',
      execute: async (cookies) => {
        const res = await fetch(`${BASE_URL}/auth/me`, { headers: { cookie: cookies } });
        const json = await res.json().catch(() => null);
        return { status: res.status, valid: res.status === 200 && json?.success === true && Boolean(json?.data?.user) };
      }
    },
    notifications: {
      name: 'GET /notifications',
      execute: async (cookies) => {
        const res = await fetch(`${BASE_URL}/notifications`, { headers: { cookie: cookies } });
        const json = await res.json().catch(() => null);
        return { status: res.status, valid: res.status === 200 && Array.isArray(json?.data?.notifications) };
      }
    },
    unreadCount: {
      name: 'GET /notifications/unread-count',
      execute: async (cookies) => {
        const res = await fetch(`${BASE_URL}/notifications/unread-count`, { headers: { cookie: cookies } });
        const json = await res.json().catch(() => null);
        return { status: res.status, valid: res.status === 200 && typeof json?.data?.count === 'number' };
      }
    },
  };

  // VU Pool State
  let targetVUs = 0;
  let activeVUs = 0;
  let isRunning = true;
  let recentRequests = 0;
  let recentLatencies = [];
  let lastSampleTime = Date.now();

  async function virtualUserWorker(vuId) {
    activeVUs++;

    // VU Persona Assignment:
    // VUs 1-10: Public Guest
    // VUs 11-15: Member User
    // VUs 16-20: Creator User
    let personaType = 'guest';
    let cookies = authData.guestCookies;
    let journeyActions = [];

    if (vuId <= 10) {
      personaType = 'guest';
      cookies = authData.guestCookies;
      journeyActions = [
        actionDefinitions.pages,
        actionDefinitions.creatorPage,
        actionDefinitions.creatorPosts,
        actionDefinitions.postDetail,
        actionDefinitions.creatorTiers,
        actionDefinitions.health,
        actionDefinitions.csrf,
      ];
    } else if (vuId <= 15) {
      personaType = 'member';
      cookies = authData.memberCookies;
      journeyActions = [
        actionDefinitions.authMe,
        actionDefinitions.notifications,
        actionDefinitions.unreadCount,
        actionDefinitions.creatorPage,
        actionDefinitions.creatorPosts,
        actionDefinitions.postDetail,
        actionDefinitions.creatorTiers,
      ];
    } else {
      personaType = 'creator';
      cookies = authData.creatorCookies;
      journeyActions = [
        actionDefinitions.authMe,
        actionDefinitions.notifications,
        actionDefinitions.unreadCount,
        actionDefinitions.pages,
        actionDefinitions.creatorPage,
        actionDefinitions.creatorPosts,
        actionDefinitions.postDetail,
      ];
    }

    let actionIndex = (vuId * 2) % journeyActions.length;

    while (isRunning && activeVUs <= targetVUs) {
      const action = journeyActions[actionIndex % journeyActions.length];
      actionIndex++;

      const tStart = performance.now();
      let status = 0;
      let valid = false;
      let isTimeout = false;
      let errorDetail = null;

      try {
        const result = await Promise.race([
          action.execute(cookies),
          new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 15000))
        ]);
        status = result.status;
        valid = result.valid;
        if (!valid) {
          errorDetail = `Invalid response structure (status ${status})`;
        }
      } catch (err) {
        if (err.message === 'TIMEOUT') {
          isTimeout = true;
          status = 504;
          errorDetail = 'Request timed out after 15s';
        } else {
          status = 599;
          errorDetail = err.message;
        }
        valid = false;
      }

      const durationMs = performance.now() - tStart;
      collector.record(action.name, durationMs, status, valid, isTimeout, errorDetail);
      recentRequests++;
      recentLatencies.push(durationMs);

      // Realistic user think time between actions (only 1 request in flight per VU)
      await sleep(randomThinkTime(12000, 16000));
    }

    activeVUs--;
  }

  // Periodic Telemetry Reporter Loop (every 15 seconds)
  const monitorInterval = setInterval(async () => {
    if (!isRunning) return;
    const now = Date.now();
    const elapsedSec = (now - lastSampleTime) / 1000;
    const currentRate = elapsedSec > 0 ? (recentRequests / elapsedSec) : 0;
    const avgLatency = recentLatencies.length > 0 
      ? Number((recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length).toFixed(1)) 
      : 0;

    recentRequests = 0;
    recentLatencies = [];
    lastSampleTime = now;

    // Check service readiness
    let mongoStatus = 'unknown';
    let redisStatus = 'unknown';
    try {
      const readyRes = await fetch(`${BASE_URL}/ready`);
      const readyJson = await readyRes.json();
      mongoStatus = readyJson.data?.services?.mongodb || 'disconnected';
      redisStatus = readyJson.data?.services?.redis || 'disconnected';
    } catch {
      mongoStatus = 'error';
      redisStatus = 'error';
    }

    collector.recordTimeSample(activeVUs, Number(currentRate.toFixed(2)), avgLatency, mongoStatus, redisStatus);

    const timeStr = new Date().toLocaleTimeString();
    console.log(`  [${timeStr}] Active VUs: ${String(activeVUs).padStart(2)}/${String(targetVUs).padStart(2)} | Rate: ${currentRate.toFixed(2).padStart(5)} req/s | Rolling Avg Latency: ${String(avgLatency).padStart(6)}ms | DB: ${mongoStatus.padEnd(9)} | Redis: ${redisStatus}`);
  }, 15000);

  // Execute Stages
  collector.startTime = Date.now();
  console.log('\n[Stage Execution Started]');

  for (let stageIdx = 0; stageIdx < STAGES.length; stageIdx++) {
    const stage = STAGES[stageIdx];
    console.log(`\n>>> Entering Stage ${stageIdx + 1}/${STAGES.length}: ${stage.name} (Target: ${stage.vus} VUs, Duration: ${stage.durationSec}s)`);
    targetVUs = stage.vus;

    // Scale up VUs if needed
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

  console.log('\n[Cool-down] Settling remaining active virtual users...');
  let settleWait = 0;
  while (activeVUs > 0 && settleWait < 50) {
    await sleep(200);
    settleWait++;
  }
  collector.endTime = Date.now();

  // Summarize
  const summary = collector.getSummary();

  console.log('\n' + '='.repeat(128));
  console.log(` COMMONS STAGE 3: 20 CONCURRENT VIRTUAL USERS LOAD TEST RESULTS`);
  console.log('='.repeat(128));
  console.log(` Target Service:         ${summary.metadata.targetUrl} (Render Oregon)`);
  console.log(` Database:               ${summary.metadata.mongodbRegion}`);
  console.log(` Peak Concurrent Users:  ${summary.metadata.peakVUs} VUs`);
  console.log(` Total Test Duration:    ${summary.metadata.totalDurationSec}s (${(summary.metadata.totalDurationSec / 60).toFixed(1)} min)`);
  console.log(` Peak Hold Duration:     ${summary.metadata.holdMinutes} minutes`);
  console.log(` Total Requests Served:  ${summary.metrics.totalRequests.toLocaleString()}`);
  console.log(` Successful Requests:    ${summary.metrics.successRequests.toLocaleString()} (${((summary.metrics.successRequests / (summary.metrics.totalRequests || 1)) * 100).toFixed(2)}%)`);
  console.log(` Failed Requests:        ${summary.metrics.failedRequests} (${summary.metrics.overallErrorPct}%)`);
  console.log(` Rate Limited (429):     ${summary.metrics.rateLimited429}`);
  console.log(` Request Timeouts (15s): ${summary.metrics.timeouts}`);
  console.log(` Average Throughput:     ${summary.metrics.avgRequestRate} req/s (~${(summary.metrics.avgRequestRate * 60).toFixed(1)} req/min)`);
  console.log('='.repeat(128));

  // Table
  console.log(
    '| ' +
    'Endpoint'.padEnd(40) + ' | ' +
    'Category'.padEnd(19) + ' | ' +
    'Reqs'.padStart(6) + ' | ' +
    'p50'.padStart(8) + ' | ' +
    'p90'.padStart(8) + ' | ' +
    'p95'.padStart(8) + ' | ' +
    'p99'.padStart(8) + ' | ' +
    'Max'.padStart(8) + ' | ' +
    'Target'.padStart(7) + ' | ' +
    'Baseline'.padStart(8) + ' | ' +
    'Degrad'.padStart(8) + ' | ' +
    'Verdict'.padEnd(7) + ' |'
  );
  console.log('|' + '-'.repeat(42) + '|' + '-'.repeat(21) + '|' + '-'.repeat(8) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(9) + '|' + '-'.repeat(10) + '|' + '-'.repeat(10) + '|' + '-'.repeat(9) + '|');

  for (const ep of summary.endpoints) {
    const degradStr = ep.degradationPct >= 0 ? `+${ep.degradationPct}%` : `${ep.degradationPct}%`;
    const verdictStr = ep.pass ? 'PASS' : (ep.errorCount === 0 ? 'MARGINAL' : 'FAIL');

    console.log(
      '| ' +
      ep.name.padEnd(40) + ' | ' +
      ep.category.padEnd(19) + ' | ' +
      String(ep.totalRequests).padStart(6) + ' | ' +
      `${ep.p50}ms`.padStart(8) + ' | ' +
      `${ep.p90}ms`.padStart(8) + ' | ' +
      `${ep.p95}ms`.padStart(8) + ' | ' +
      `${ep.p99}ms`.padStart(8) + ' | ' +
      `${ep.max}ms`.padStart(8) + ' | ' +
      `<${ep.targetP95}ms`.padStart(7) + ' | ' +
      `${ep.baselineP95 ? ep.baselineP95 + 'ms' : 'N/A'}`.padStart(8) + ' | ' +
      degradStr.padStart(8) + ' | ' +
      verdictStr.padEnd(7) + ' |'
    );
  }
  console.log('='.repeat(128));

  // Save JSON artifacts
  const resultsDir = path.resolve('performance-results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const resultsPath = path.join(resultsDir, 'stage3-oregon-load-test-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n✓ Stage 3 results JSON saved to: ${resultsPath}`);

  // Also save to root load-test-results.json for backward compatibility
  fs.writeFileSync(path.resolve('load-test-results.json'), JSON.stringify(summary, null, 2), 'utf-8');

  return summary;
}

runStage3LoadTest().catch(err => {
  console.error('\n❌ Fatal Load Test Error:', err);
  process.exit(1);
});
