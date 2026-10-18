/**
 * Commons Production Controlled Concurrency Test (20-User Synchronized Waves)
 *
 * Simulates 20 concurrent clients against the live Render API (https://api.commons.pk).
 * Strict Safety Parameters:
 * - 20 virtual users fire simultaneously in synchronized waves.
 * - 30-second pause between waves.
 * - Total request throughput: ~40 requests/min (capped well under the 60 req/min target and 100 req/min production limit).
 * - Rotates through verified read-only endpoints only.
 * - 10 waves total (~5 minutes run time).
 * - Immediate abort if unexpected 429 or server errors occur.
 * - Tracks cold-start (Wave 1) separately from warm (Waves 2-10).
 */

const BASE_URL = process.env.BASE_URL || 'https://api.commons.pk';
const VUS_PER_WAVE = 20;
const TOTAL_WAVES = 10;
const PAUSE_SECONDS = 30;

const ENDPOINTS = [
  { name: 'GET /health', path: '/health', category: 'Simple Public Read' },
  { name: 'GET /ready', path: '/ready', category: 'Simple Public Read' },
  { name: 'GET /pages', path: '/pages', category: 'Simple Public Read' },
  { name: 'GET /pages/commons', path: '/pages/commons', category: 'Complex DB Read' },
  { name: 'GET /posts/creator?pageSlug=commons', path: '/posts/creator?pageSlug=commons', category: 'Complex DB Read' },
  { name: 'GET /posts/6ab670e11d78868df779cf94', path: '/posts/6ab670e11d78868df779cf94', category: 'Complex DB Read' },
  { name: 'GET /tiers/creator/6a4ab792301861fbab5f22c8', path: '/tiers/creator/6a4ab792301861fbab5f22c8', category: 'Complex DB Read' },
];

function calculateStats(samples) {
  if (samples.length === 0) return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  const p99 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)];

  return {
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    avg: Number(avg.toFixed(2)),
    p50: Number(p50.toFixed(2)),
    p90: Number(p90.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    p99: Number(p99.toFixed(2)),
  };
}

async function runSingleRequest(endpoint, vuId, waveNum) {
  const startTime = performance.now();
  try {
    const res = await fetch(`${BASE_URL}${endpoint.path}`, {
      headers: {
        'User-Agent': `Commons-Production-Validation-VU-${vuId}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    const duration = performance.now() - startTime;
    const status = res.status;
    let body = null;
    try {
      body = await res.json();
    } catch {
      // Body may not be JSON
    }

    const isValid = status === 200 && (body?.success === true || status === 200);

    return {
      endpoint: endpoint.name,
      path: endpoint.path,
      vuId,
      waveNum,
      duration,
      status,
      isValid,
      is429: status === 429,
      isError: status >= 500 || !isValid,
      errorMsg: null,
    };
  } catch (err) {
    const duration = performance.now() - startTime;
    return {
      endpoint: endpoint.name,
      path: endpoint.path,
      vuId,
      waveNum,
      duration,
      status: err.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      isValid: false,
      is429: false,
      isError: true,
      errorMsg: err.message,
    };
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runProductionValidation() {
  console.log('='.repeat(90));
  console.log(` PRODUCTION CONCURRENCY VALIDATION — COMMONS`);
  console.log(` Target Server:  ${BASE_URL}`);
  console.log(` Concurrency:    ${VUS_PER_WAVE} Virtual Users fired SIMULTANEOUSLY per wave`);
  console.log(` Waves:          ${TOTAL_WAVES} synchronized waves`);
  console.log(` Inter-wave:     ${PAUSE_SECONDS} seconds pause`);
  console.log(` Total Requests: ${VUS_PER_WAVE * TOTAL_WAVES} requests (~${(VUS_PER_WAVE / (PAUSE_SECONDS / 60)).toFixed(0)} req/min)`);
  console.log(` Safety Limit:   Below 60 req/min (Production limit: 100 req/min)`);
  console.log('='.repeat(90) + '\n');

  const allResults = [];
  const waveSummaries = [];

  for (let wave = 1; wave <= TOTAL_WAVES; wave++) {
    const waveStartTime = performance.now();
    console.log(`>>> Starting Wave ${wave}/${TOTAL_WAVES} — Firing ${VUS_PER_WAVE} concurrent requests...`);

    // Assign endpoints in round-robin across the 20 VUs
    const requestPromises = [];
    for (let vu = 0; vu < VUS_PER_WAVE; vu++) {
      const endpoint = ENDPOINTS[vu % ENDPOINTS.length];
      requestPromises.push(runSingleRequest(endpoint, vu + 1, wave));
    }

    // Fire all 20 requests concurrently
    const waveResults = await Promise.all(requestPromises);
    const waveDuration = performance.now() - waveStartTime;
    allResults.push(...waveResults);

    // Wave statistics
    const waveLatencies = waveResults.map(r => r.duration);
    const waveStats = calculateStats(waveLatencies);
    const wave429s = waveResults.filter(r => r.is429).length;
    const waveErrors = waveResults.filter(r => r.isError).length;
    const waveSuccess = waveResults.filter(r => r.isValid).length;

    waveSummaries.push({
      wave,
      durationMs: waveDuration,
      stats: waveStats,
      successCount: waveSuccess,
      errorCount: waveErrors,
      rateLimitedCount: wave429s,
    });

    console.log(`    Wave ${wave} Complete in ${waveDuration.toFixed(0)}ms: ` +
      `p50: ${waveStats.p50}ms | p95: ${waveStats.p95}ms | max: ${waveStats.max}ms | ` +
      `OK: ${waveSuccess}/${VUS_PER_WAVE} | 429: ${wave429s} | Errors: ${waveErrors}`);

    // Safety check: if 429s or errors exceed tolerance, abort
    if (wave429s > 0) {
      console.error(`\x1b[31m[SAFETY ABORT] HTTP 429 Rate Limit encountered in Wave ${wave}. Stopping test immediately.\x1b[0m`);
      break;
    }
    if (waveErrors > 2) {
      console.error(`\x1b[31m[SAFETY ABORT] Elevated error count (${waveErrors}) in Wave ${wave}. Stopping test immediately.\x1b[0m`);
      break;
    }

    // Pause before next wave (except after final wave)
    if (wave < TOTAL_WAVES) {
      process.stdout.write(`    Pausing ${PAUSE_SECONDS}s to keep rate safely below 60 req/min... `);
      await sleep(PAUSE_SECONDS * 1000);
      console.log('Resuming.\n');
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log(` PRODUCTION CONCURRENCY VALIDATION RESULTS SUMMARY`);
  console.log('='.repeat(100));

  // Separate Cold-Start (Wave 1) vs Warm (Waves 2-10)
  const wave1Results = allResults.filter(r => r.waveNum === 1);
  const warmResults = allResults.filter(r => r.waveNum > 1);

  const wave1Stats = calculateStats(wave1Results.map(r => r.duration));
  const warmStats = calculateStats(warmResults.map(r => r.duration));
  const overallStats = calculateStats(allResults.map(r => r.duration));

  console.log(`\n--- Burst Execution Overview ---`);
  console.log(`Total Waves Completed:      ${waveSummaries.length}/${TOTAL_WAVES}`);
  console.log(`Total Requests Sent:        ${allResults.length}`);
  console.log(`Successful Requests:        ${allResults.filter(r => r.isValid).length} (${((allResults.filter(r => r.isValid).length / allResults.length) * 100).toFixed(1)}%)`);
  console.log(`Failed Requests:            ${allResults.filter(r => r.isError).length}`);
  console.log(`HTTP 429 Rate-Limited:      ${allResults.filter(r => r.is429).length}`);

  console.log(`\n--- Cold-Start vs Warm Burst Comparison ---`);
  console.log(`Wave 1 (Initial Burst):     p50: ${wave1Stats.p50}ms | p95: ${wave1Stats.p95}ms | max: ${wave1Stats.max}ms | avg: ${wave1Stats.avg}ms`);
  console.log(`Waves 2-${waveSummaries.length} (Warm Bursts):   p50: ${warmStats.p50}ms | p95: ${warmStats.p95}ms | max: ${warmStats.max}ms | avg: ${warmStats.avg}ms`);
  console.log(`Overall Combined:           p50: ${overallStats.p50}ms | p95: ${overallStats.p95}ms | max: ${overallStats.max}ms | avg: ${overallStats.avg}ms`);

  // Per Endpoint Analysis
  console.log('\n' + '-'.repeat(105));
  console.log(' PER-ENDPOINT BREAKDOWN UNDER 20-CONCURRENT-CLIENT BURSTS');
  console.log('-'.repeat(105));

  const endpointRows = [];
  for (const ep of ENDPOINTS) {
    const epResults = allResults.filter(r => r.endpoint === ep.name);
    if (epResults.length === 0) continue;

    const latencies = epResults.map(r => r.duration);
    const stats = calculateStats(latencies);
    const okCount = epResults.filter(r => r.isValid).length;
    const failCount = epResults.filter(r => r.isError).length;
    const codes = {};
    for (const r of epResults) {
      codes[r.status] = (codes[r.status] || 0) + 1;
    }

    endpointRows.push({
      name: ep.name,
      category: ep.category,
      total: epResults.length,
      ok: okCount,
      fail: failCount,
      stats,
      codes,
    });
  }

  // Print formatted table
  console.log(
    '| ' + 'Endpoint'.padEnd(42) + ' | ' +
    'OK/Total'.padEnd(9) + ' | ' +
    'p50'.padStart(7) + ' | ' +
    'p90'.padStart(7) + ' | ' +
    'p95'.padStart(7) + ' | ' +
    'Max'.padStart(7) + ' | ' +
    'Avg'.padStart(7) + ' | ' +
    'Statuses'.padEnd(12) + ' |'
  );
  console.log('|' + '-'.repeat(44) + '|' + '-'.repeat(11) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(14) + '|');

  for (const row of endpointRows) {
    const codesStr = Object.entries(row.codes).map(([c, n]) => `${c}:${n}`).join(' ');
    console.log(
      '| ' + row.name.padEnd(42) + ' | ' +
      `${row.ok}/${row.total}`.padEnd(9) + ' | ' +
      `${row.stats.p50}ms`.padStart(7) + ' | ' +
      `${row.stats.p90}ms`.padStart(7) + ' | ' +
      `${row.stats.p95}ms`.padStart(7) + ' | ' +
      `${row.stats.max}ms`.padStart(7) + ' | ' +
      `${row.stats.avg}ms`.padStart(7) + ' | ' +
      codesStr.padEnd(12) + ' |'
    );
  }
  console.log('-'.repeat(105));

  // Write results JSON
  const outputFilePath = 'c:/Users/d/Documents/commons/server/production-validation-results.json';
  const reportData = {
    targetUrl: BASE_URL,
    timestamp: new Date().toISOString(),
    configuration: {
      vusPerWave: VUS_PER_WAVE,
      totalWaves: waveSummaries.length,
      pauseSeconds: PAUSE_SECONDS,
      ratePerMinute: (VUS_PER_WAVE / (PAUSE_SECONDS / 60)).toFixed(0),
    },
    waveSummaries,
    overallStats,
    wave1Stats,
    warmStats,
    endpoints: endpointRows,
  };

  import('fs').then(fs => {
    fs.writeFileSync(outputFilePath, JSON.stringify(reportData, null, 2));
    console.log(`\nResults saved to: ${outputFilePath}`);
  });

  return reportData;
}

runProductionValidation().catch(err => {
  console.error('\n❌ Fatal Validation Error:', err);
  process.exit(1);
});
