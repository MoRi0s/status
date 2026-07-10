const $ = (id) => document.getElementById(id);
const serviceIds = ['website', 'bot', 'api', 'mail'];

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value ?? 'N/A';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : 'N/A';
}

function formatTemperature(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}°C` : 'N/A';
}

function setService(id, state) {
  const label = $(`${id}-status`);
  const dot = label?.previousElementSibling;
  const text = state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : 'Not configured';
  if (label) label.textContent = text;
  if (dot) dot.className = `status-dot ${state === 'online' ? 'online' : state === 'offline' ? 'offline' : 'warning'}`;
}

function setOverall(state) {
  const banner = $('incident-banner');
  if (state === 'online') {
    banner.className = 'incident online';
    banner.textContent = '🟢 All Systems Operational';
  } else if (state === 'offline') {
    banner.className = 'incident offline';
    banner.textContent = '🔴 Service disruption detected';
  } else {
    banner.className = 'incident warning';
    banner.textContent = '🟡 Monitoring service is not configured';
  }
}

function drawChart(id, values, color, fill) {
  const canvas = $(id);
  const ctx = canvas.getContext('2d');
  const scale = devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  canvas.width = width * scale;
  canvas.height = height * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const cleanValues = values.filter(Number.isFinite);
  const points = cleanValues.length > 1 ? cleanValues : [cleanValues[0] ?? 0, cleanValues[0] ?? 0];
  const pad = 10;
  const max = Math.max(...points, 1) * 1.16;
  const step = (width - pad * 2) / (points.length - 1);
  ctx.strokeStyle = '#2a3040';
  ctx.lineWidth = 1;
  for (let index = 1; index < 4; index += 1) {
    const y = pad + ((height - pad * 2) * index) / 4;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(width - pad, y); ctx.stroke();
  }
  const coordinates = points.map((value, index) => [pad + index * step, height - pad - (value / max) * (height - pad * 2)]);
  ctx.beginPath();
  coordinates.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.lineTo(coordinates.at(-1)[0], height - pad); ctx.lineTo(pad, height - pad); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.beginPath(); coordinates.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
}

function renderCharts(history) {
  drawChart('cpuChart', history.map((sample) => sample.cpu), '#57e49b', '#57e49b1c');
  drawChart('tempChart', history.map((sample) => sample.temperature), '#f2bd4e', '#f2bd4e1b');
  drawChart('storageChart', history.map((sample) => sample.disk), '#78a8ff', '#78a8ff1b');
  drawChart('networkChart', history.map((sample) => sample.network), '#c183ff', '#c183ff1b');
}

let latestHistory = [];
function applyStatus(data) {
  setOverall(data.overall);
  setText('last-update', new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.collectedAt)));
  setText('cpu-model', data.hardware.cpu || 'N/A');
  setText('ram', data.hardware.memory);
  setText('storage', data.hardware.storage);
  setText('os', data.hardware.os);
  setText('cpu-load', formatPercent(data.metrics.cpu));
  setText('memory-load', formatPercent(data.metrics.memory));
  setText('disk-load', formatPercent(data.metrics.disk));
  setText('cpu-temp', formatTemperature(data.metrics.temperature));
  setText('uptime', data.metrics.uptime);
  setText('uptime-today', data.uptime.today);
  setText('uptime-7', data.uptime.sevenDays);
  setText('uptime-30', data.uptime.thirtyDays);
  setText('uptime-90', data.uptime.ninetyDays);
  setText('running-days', data.uptime.runningDays);
  const services = new Map(data.services.map((service) => [service.id, service.state]));
  serviceIds.forEach((id) => setService(id, services.get(id) || 'unknown'));
  latestHistory = data.history || [];
  renderCharts(latestHistory);
  setText('restart-history', 'OS uptime is monitored live. Historical restart logs can be added from your monitor.');
  setText('incident-history', data.overall === 'offline' ? '現在、いずれかの監視対象で応答エラーを検出しています。' : '現在、報告する障害はありません。');
}

async function refreshStatus() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    applyStatus(await response.json());
  } catch (error) {
    setOverall('offline');
    setText('last-update', '監視APIに接続できません');
    console.error('Status API error:', error);
  }
}

refreshStatus();
setInterval(refreshStatus, 30_000);
addEventListener('resize', () => renderCharts(latestHistory));
