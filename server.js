const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const net = require('net');
const si = require('systeminformation');
const axios = require('axios');

const app = express();
const port = Number(process.env.PORT || 4000);
const sampleIntervalMs = 60_000;
const historyFile = process.env.STATUS_HISTORY_FILE || path.join(__dirname, 'data', 'metrics-history.json');
const historyLimit = 43_200; // 30 days at one sample per minute
let history = [];

function number(value, digits = 1) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function percent(used, total) {
  return total > 0 ? number((used / total) * 100) : null;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${days} days, ${hours} hours, ${minutes} minutes`;
}

function overallState(services) {
  if (services.length === 0) return 'unknown';
  return services.some((service) => service.state === 'offline') ? 'offline' : 'online';
}

function monitoredUptime(periodMs) {
  const now = Date.now();
  const periodStart = now - periodMs;
  const samples = history.filter((sample) => {
    const timestamp = Date.parse(sample.at);
    return Number.isFinite(timestamp) && timestamp >= periodStart && (sample.overall === 'online' || sample.overall === 'offline');
  });
  if (samples.length === 0) return 'N/A';
  const online = samples.filter((sample) => sample.overall === 'online').length;
  const rate = ((online / samples.length) * 100).toFixed(2);
  const firstSampleAt = Date.parse(samples[0].at);
  const isPartialPeriod = firstSampleAt > periodStart + sampleIntervalMs;
  return `${rate}%${isPartialPeriod ? ' (obs.)' : ''}`;
}

function configuredServices() {
  try {
    const parsed = JSON.parse(process.env.STATUS_SERVICES || '[]');
    if (!Array.isArray(parsed)) throw new Error('STATUS_SERVICES must be an array');
    return parsed.filter((service) => {
      if (!service || typeof service.id !== 'string') return false;
      const type = service.type || 'http';
      return (type === 'http' && typeof service.url === 'string')
        || (type === 'systemd' && typeof service.service === 'string')
        || (type === 'pm2' && typeof service.process === 'string')
        || (type === 'tcp' && typeof service.host === 'string' && Number.isInteger(service.port));
    });
  } catch (error) {
    console.error(`Invalid STATUS_SERVICES: ${error.message}`);
    return [];
  }
}

function checkSystemdService(service, timeout) {
  return new Promise((resolve) => {
    execFile('systemctl', ['is-active', '--quiet', service.service], { timeout }, (error) => {
      resolve({ id: service.id, state: error ? 'offline' : 'online' });
    });
  });
}

function checkTcpService(service, timeout) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: service.host, port: service.port });
    const finish = (state) => {
      socket.destroy();
      resolve({ id: service.id, state });
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish('online'));
    socket.once('timeout', () => finish('offline'));
    socket.once('error', () => finish('offline'));
  });
}

function checkPm2Service(service, timeout) {
  return new Promise((resolve) => {
    execFile(process.env.PM2_BIN || 'pm2', ['jlist'], { timeout, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve({ id: service.id, state: 'offline' });
      try {
        const processes = JSON.parse(stdout);
        const process = processes.find((item) => item.name === service.process);
        return resolve({ id: service.id, state: process?.pm2_env?.status === 'online' ? 'online' : 'offline' });
      } catch (_error) {
        return resolve({ id: service.id, state: 'offline' });
      }
    });
  });
}

async function checkService(service) {
  const timeout = Number(process.env.STATUS_CHECK_TIMEOUT_MS || 5_000);
  const startedAt = Date.now();
  const type = service.type || 'http';
  if (type === 'systemd') return checkSystemdService(service, timeout);
  if (type === 'pm2') return checkPm2Service(service, timeout);
  if (type === 'tcp') return checkTcpService(service, timeout);
  try {
    const response = await axios.get(service.url, {
      timeout,
      validateStatus: () => true,
      maxRedirects: 3,
      headers: { 'User-Agent': 'morixxx-status-monitor/1.0' },
    });
    const online = response.status >= 200 && response.status < 400;
    return { id: service.id, state: online ? 'online' : 'offline', statusCode: response.status, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { id: service.id, state: 'offline', latencyMs: Date.now() - startedAt };
  }
}

async function collectMetrics() {
  const [cpu, load, memory, disks, temperature, os, time, network] = await Promise.all([
    si.cpu(), si.currentLoad(), si.mem(), si.fsSize(), si.cpuTemperature(), si.osInfo(), si.time(), si.networkStats(),
  ]);
  const persistentDisks = disks.filter((disk) => disk.size > 0 && !String(disk.fs).startsWith('tmpfs'));
  const rootDisk = persistentDisks.find((disk) => disk.mount === '/') || persistentDisks.sort((a, b) => b.size - a.size)[0];
  const networkTraffic = network.reduce((total, item) => total + (item.rx_sec || 0) + (item.tx_sec || 0), 0);
  const services = await Promise.all(configuredServices().map(checkService));

  return {
    collectedAt: new Date().toISOString(),
    hardware: {
      cpu: cpu.brand || `${cpu.manufacturer || ''} ${cpu.family || ''}`.trim() || 'N/A',
      memory: memory.total ? `${number(memory.total / 1024 ** 3)} GB` : 'N/A',
      storage: rootDisk?.size ? `${number(rootDisk.size / 1024 ** 3)} GB ${rootDisk.type || ''}`.trim() : 'N/A',
      os: `${os.distro || os.platform || 'Linux'} ${os.release || ''}`.trim(),
    },
    metrics: {
      cpu: number(load.currentLoad),
      memory: percent(memory.used, memory.total),
      disk: rootDisk ? number(rootDisk.use) : null,
      temperature: number(temperature.main),
      uptimeSeconds: time.uptime,
      uptime: formatUptime(time.uptime),
      runningDays: `${Math.floor(time.uptime / 86_400)} Days`,
      networkBytesPerSecond: number(networkTraffic, 0),
    },
    services,
  };
}

function compactSample(snapshot) {
  return {
    at: snapshot.collectedAt,
    cpu: snapshot.metrics.cpu,
    temperature: snapshot.metrics.temperature,
    disk: snapshot.metrics.disk,
    network: snapshot.metrics.networkBytesPerSecond,
    overall: snapshot.overall,
  };
}

async function saveHistory() {
  await fs.mkdir(path.dirname(historyFile), { recursive: true });
  await fs.writeFile(historyFile, JSON.stringify(history), 'utf8');
}

async function sample() {
  try {
    const snapshot = await collectMetrics();
    snapshot.overall = overallState(snapshot.services);
    history.push(compactSample(snapshot));
    history = history.slice(-historyLimit);
    await saveHistory();
    return snapshot;
  } catch (error) {
    console.error(`Could not collect server metrics: ${error.message}`);
    throw error;
  }
}

async function loadHistory() {
  try {
    const content = await fs.readFile(historyFile, 'utf8');
    const saved = JSON.parse(content);
    history = Array.isArray(saved) ? saved.slice(-historyLimit) : [];
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`Could not read metric history: ${error.message}`);
  }
}

app.get('/api/status', async (_request, response) => {
  try {
    const snapshot = await sample();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    response.set('Cache-Control', 'no-store').json({
      overall: snapshot.overall,
      ...snapshot,
      uptime: {
        today: monitoredUptime(Date.now() - startOfToday.getTime()),
        sevenDays: monitoredUptime(7 * 86_400_000),
        thirtyDays: monitoredUptime(30 * 86_400_000),
        ninetyDays: monitoredUptime(90 * 86_400_000),
        runningDays: snapshot.metrics.runningDays,
      },
      history,
    });
  } catch (_error) {
    response.status(503).json({ error: 'Metrics are temporarily unavailable.' });
  }
});

app.use(express.static(__dirname, { index: 'index.html', dotfiles: 'deny' }));

loadHistory().then(async () => {
  await sample().catch(() => {});
  setInterval(() => { sample().catch(() => {}); }, sampleIntervalMs);
  app.listen(port, () => console.log(`Status server listening on port ${port}`));
});
