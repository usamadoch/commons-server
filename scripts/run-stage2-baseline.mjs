/**
 * Stage 2: Single-User Sequential Read-Only Baseline Benchmark
 *
 * Measures single-user sequential latency across verified safe read endpoints
 * on the live production backend (https://api.commons.pk).
 *
 * Paced at ~45-50 requests/min to strictly respect production rate limits (100 req/min).
 * Validates payload integrity, calculates percentiles (min, avg, p50, p90, p95, p99, max),
 * and saves raw telemetry to performance-results/stage2-sequential-baseline-results.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BASE_URL || 'https://api.commons.pk';
const WARMUP_COUNT = 3;
const MEASURE_COUNT = 35;
const INTER_REQUEST_DELAY_MS = 650; // Delay to keep request rate ~45 req/min
const REQUEST_TIMEOUT_MS = 15000;

const OREGON_FIXTURES = {
  pageSlug: 'commons',
  postId: '6ab670e11d78868df779cf94',
  creatorId: '6a4ab792301861fbab5f22c8',
};

const ENDPOINTS = [
  {
    name: 'GET /health',
    category: 'Simple Public Read',
    path: '/health',
    targetP95: 500,
    validate: (status, body) => status === 200 && body?.success === true && body?.data?.status === 'ok',
  },
  {
    name: 'GET /ready',
    category: 'Simple Public Read',
    path: '/ready',
    targetP95: 500,
    validate: (status, body) => status === 200 && body?.success === true,
  },
  {
    name: 'GET /auth/csrf',
    category: 'Simple Public Read',
    path: '/auth/csrf',
    targetP95: 500,
    validate: (status, body) => status === 200 && body?.success === true && typeof body?.data?.csrfToken === 'string',
  },
  {
    name: 'GET /pages',
    category: 'Simple Public Read',
    path: '/pages',
    targetP95: 500,
    validate: (status, body) => status === 200 && body?.success === true && Array.isArray(body?.data?.pages),
  },
  {
    name: 'GET /pages/commons',
    category: 'Complex DB Read',
    path: `/pages/${OREGON_FIXTURES.pageSlug}`,
    targetP95: 800,
    validate: (status, body) => status === 200 && body?.success === true && body?.data?.page?.pageSlug === 'commons',
  },
  {
    name: 'GET /posts/creator?pageSlug=commons',
    category: 'Complex DB Read',
    path: `/posts/creator?pageSlug=${OREGON_FIXTURES.pageSlug}`,
    targetP95: 800,
    validate: (status, body) => status === 200 && body?.success === true && Array.isArray(body?.data?.posts),
  },
  {
    name: 'GET /posts/:id',
    category: 'Complex DB Read',
    path: `/posts/${OREGON_FIXTURES.postId}`,
    targetP95: 800,
    validate: (status, body) => status === 200 && body?.success === true && Boolean(body?.data?.post?._id),
  },
  {
    name: 'GET /tiers/creator/:id',
    category: 'Complex DB Read',
    path: `/tiers/creator/${OREGON_FIXTURES.creatorId}`,
    targetP95: 800,
    validate: (status, body) => status === 200 && body?.success === true && Array.isArray(body?.data?.plans),
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculatePercentiles(samples) {
  if (samples.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avg = sum / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  const p95 = sorted[p95Index];
  const p99Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1);
  const p99 = sorted[p99Index];

  return {
    min: Number(min.toFixed(2)),
    avg: Number(avg.toFixed(2)),
    p50: Number(p50.toFixed(2)),
    p90: Number(p90.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    p99: Number(p99.toFixed(2)),
    max: Number(max.toFixed(2)),
  };
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Commons-Stage2-Baseline/1.0',
        Accept: 'application/json',
      },
    });
    const t1 = performance.now();
    clearTimeout(timer);
    const duration = t1 - t0;
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return {
      ok: true,
      status: res.status,
      duration,
      body,
      headers: Object.fromEntries(res.headers.entries()),
    };
  } catch (err) {
    clearTimeout(timer);
    const t1 = performance.now();
    return {
      ok: false,
      status: err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      duration: t1 - t0,
      error: err.message,
    };
  }
}

async function runStage2Baseline() {
  const runStart = Date.now();
  console.log('='.repeat(90));
  console.log('  COMMONS STAGE 2: SINGLE-USER SEQUENTIAL READ-ONLY BASELINE BENCHMARK');
  console.log(`  Target URL:        ${BASE_URL}`);
  console.log(`  Warm-up:           ${WARMUP_COUNT} requests/endpoint`);
  console.log(`  Measured:          ${MEASURE_COUNT} requests/endpoint (Sequential)`);
  console.log(`  Inter-req Delay:   ${INTER_REQUEST_DELAY_MS}ms (Pacing ~45 req/min)`);
  console.log(`  Total Endpoints:   ${ENDPOINTS.length}`);
  console.log('='.repeat(90));

  // Probe server headers
  const probe = await fetchWithTimeout(`${BASE_URL}/health`);
  const renderOrigin = probe.headers?.['x-render-origin-server'] || 'Unknown';
  const renderId = probe.headers?.['rndr-id'] || 'Unknown';
  const cfRay = probe.headers?.['cf-ray'] || 'Unknown';

  console.log(`\nInfrastructure Telemetry:`);
  console.log(`  Render Origin Server: ${renderOrigin}`);
  console.log(`  Render Instance ID:   ${renderId}`);
  console.log(`  Cloudflare Edge Ray:  ${cfRay}`);
  console.log(`  Target Database:      MongoDB Atlas Oregon (cluster0.0hhveup.mongodb.net)`);
  console.log(`  Target Git Commit:    5662a13 (deployed production HEAD)`);
  console.log(`  Test Runner Location: Pakistan (cross-continental public internet)\n`);

  const endpointResults = [];

  for (let i = 0; i < ENDPOINTS.length; i++) {
    const ep = ENDPOINTS[i];
    console.log(`[${i + 1}/${ENDPOINTS.length}] Benchmarking ${ep.name}...`);

    // 1. Warm-up
    for (let w = 0; w < WARMUP_COUNT; w++) {
      await fetchWithTimeout(`${BASE_URL}${ep.path}`);
      await sleep(INTER_REQUEST_DELAY_MS);
    }

    // 2. Measured
    const durations = [];
    const rawSamples = [];
    let successCount = 0;
    let errorCount = 0;
    let rateLimitCount = 0;
    let timeoutCount = 0;
    const statusCodes = {};

    const epStart = performance.now();

    for (let m = 0; m < MEASURE_COUNT; m++) {
      const sample = await fetchWithTimeout(`${BASE_URL}${ep.path}`);
      durations.push(sample.duration);

      const statusKey = String(sample.status);
      statusCodes[statusKey] = (statusCodes[statusKey] || 0) + 1;

      const isValid = sample.ok && ep.validate(sample.status, sample.body);

      if (sample.status === 429) {
        rateLimitCount++;
      } else if (sample.status === 'TIMEOUT') {
        timeoutCount++;
        errorCount++;
      } else if (!isValid) {
        errorCount++;
      } else {
        successCount++;
      }

      rawSamples.push({
        sampleIndex: m + 1,
        durationMs: Number(sample.duration.toFixed(2)),
        status: sample.status,
        valid: isValid,
      });

      await sleep(INTER_REQUEST_DELAY_MS);
    }

    const epDurationSec = (performance.now() - epStart) / 1000;
    const requestRate = Number((MEASURE_COUNT / epDurationSec).toFixed(2));
    const stats = calculatePercentiles(durations);
    const passP95 = stats.p95 <= ep.targetP95 && errorCount === 0;

    const result = {
      endpoint: ep.name,
      category: ep.category,
      path: ep.path,
      targetP95: ep.targetP95,
      sampleCount: MEASURE_COUNT,
      successCount,
      errorCount,
      rateLimitCount,
      timeoutCount,
      statusCodes,
      requestRatePerSec: requestRate,
      approxRatePerMin: Number((requestRate * 60).toFixed(1)),
      stats,
      verdict: passP95 ? 'PASS' : stats.p50 <= ep.targetP95 ? 'MARGINAL' : 'FAIL',
      rawSamples,
    };

    endpointResults.push(result);

    console.log(
      `    -> p50: ${stats.p50}ms | p90: ${stats.p90}ms | p95: ${stats.p95}ms | p99: ${stats.p99}ms | max: ${stats.max}ms | OK: ${successCount}/${MEASURE_COUNT} [${result.verdict}]`
    );
  }

  const runEnd = Date.now();
  const totalDurationSec = Number(((runEnd - runStart) / 1000).toFixed(1));

  // Assemble full report JSON
  const finalTelemetry = {
    metadata: {
      suite: 'Stage 2 Single-User Sequential Read Baseline',
      timestamp: new Date().toISOString(),
      targetUrl: BASE_URL,
      renderInstanceId: renderId,
      cloudflareRay: cfRay,
      deployedGitCommit: '5662a13',
      branch: 'main',
      deploymentRegion: 'Render Oregon (AWS us-west-2)',
      databaseRegion: 'MongoDB Atlas Oregon (cluster0.0hhveup.mongodb.net)',
      cacheLayer: 'Upstash Redis Global Serverless',
      runnerLocation: 'Pakistan (cross-continental transit)',
      totalDurationSec,
      totalRequests: ENDPOINTS.length * (WARMUP_COUNT + MEASURE_COUNT),
      totalMeasuredRequests: ENDPOINTS.length * MEASURE_COUNT,
      warmupCountPerEndpoint: WARMUP_COUNT,
      measureCountPerEndpoint: MEASURE_COUNT,
      interRequestDelayMs: INTER_REQUEST_DELAY_MS,
    },
    endpoints: endpointResults.map((r) => {
      const { rawSamples, ...summary } = r;
      return summary;
    }),
    rawDetailedSamples: endpointResults.reduce((acc, r) => {
      acc[r.endpoint] = r.rawSamples;
      return acc;
    }, {}),
  };

  const outputDir = path.join(__dirname, '..', 'performance-results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'stage2-sequential-baseline-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(finalTelemetry, null, 2), 'utf-8');
  console.log(`\n[Saved] Stage 2 baseline telemetry saved to: ${outputPath}`);

  // Summary Table Output
  console.log('\n' + '='.repeat(128));
  console.log('  COMMONS STAGE 2 BASELINE RESULTS TABLE');
  console.log('='.repeat(128));

  const headers = ['Endpoint', 'Category', 'OK/Total', 'Min', 'Avg', 'p50', 'p90', 'p95', 'p99', 'Max', 'Target', 'Status'];
  console.log(
    '| ' +
    headers[0].padEnd(38) + ' | ' +
    headers[1].padEnd(19) + ' | ' +
    headers[2].padEnd(8) + ' | ' +
    headers[3].padStart(7) + ' | ' +
    headers[4].padStart(7) + ' | ' +
    headers[5].padStart(7) + ' | ' +
    headers[6].padStart(7) + ' | ' +
    headers[7].padStart(7) + ' | ' +
    headers[8].padStart(7) + ' | ' +
    headers[9].padStart(7) + ' | ' +
    headers[10].padStart(8) + ' | ' +
    headers[11].padEnd(8) + ' |'
  );
  console.log(
    '|' + '-'.repeat(40) +
    '|' + '-'.repeat(21) +
    '|' + '-'.repeat(10) +
    '|' + '-'.repeat(9) +
    '|' + '-'.repeat(9) +
    '|' + '-'.repeat(9) +
    '|' + '-'.repeat(9) +
    '|' + '-'.repeat(9) +
    '|' + '-'.repeat(9) +
    '|' + '-'.repeat(9) +
    '|' + '-'.repeat(10) +
    '|' + '-'.repeat(10) + '|'
  );

  for (const r of endpointResults) {
    console.log(
      '| ' +
      r.endpoint.padEnd(38) + ' | ' +
      r.category.padEnd(19) + ' | ' +
      `${r.successCount}/${MEASURE_COUNT}`.padEnd(8) + ' | ' +
      `${r.stats.min}ms`.padStart(7) + ' | ' +
      `${r.stats.avg}ms`.padStart(7) + ' | ' +
      `${r.stats.p50}ms`.padStart(7) + ' | ' +
      `${r.stats.p90}ms`.padStart(7) + ' | ' +
      `${r.stats.p95}ms`.padStart(7) + ' | ' +
      `${r.stats.p99}ms`.padStart(7) + ' | ' +
      `${r.stats.max}ms`.padStart(7) + ' | ' +
      `<${r.targetP95}ms`.padStart(8) + ' | ' +
      r.verdict.padEnd(8) + ' |'
    );
  }
  console.log('='.repeat(128));
}

runStage2Baseline().catch((err) => {
  console.error('\nFatal Error in Stage 2 Baseline Runner:', err);
  process.exit(1);
});
