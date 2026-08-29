const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');
const outputEl = document.getElementById('output');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const logsBtn = document.getElementById('logsBtn');
const consoleForm = document.getElementById('consoleForm');
const consoleInput = document.getElementById('consoleInput');

const LIVE_REFRESH_MS = 1000;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Request failed.');
  }

  return data;
}

function setStatus(online) {
  statusText.textContent = online ? 'Server is online' : 'Server is offline';
  statusText.style.color = online ? '#86efac' : '#fca5a5';
  statusDot.style.background = online ? '#22c55e' : '#ef4444';
  statusDot.style.boxShadow = online
    ? '0 0 10px rgba(34, 197, 94, 0.8)'
    : '0 0 10px rgba(239, 68, 68, 0.8)';
}

function setOutput(value) {
  outputEl.textContent = value || 'No output returned.';
}

async function refreshLiveData() {
  try {
    const [statusData, logData] = await Promise.all([
      fetchJson('/api/status'),
      fetchJson('/api/logs'),
    ]);

    setStatus(statusData.online);
    setOutput(`Server status: ${statusData.online ? 'Online' : 'Offline'}\n\nLatest log output:\n\n${logData.output || 'No output returned.'}`);
  } catch (error) {
    setStatus(false);
    setOutput(`Live update failed.\n${error.message}`);
  }
}

async function actionRequest(endpoint, label) {
  try {
    const data = await fetchJson(endpoint, { method: 'POST' });
    setOutput(`${label}\n\n${data.output || 'No output returned.'}`);
    await refreshLiveData();
  } catch (error) {
    setOutput(`${label} failed.\n${error.message}`);
  }
}

startBtn.addEventListener('click', () => actionRequest('/api/start', 'Start output'));
stopBtn.addEventListener('click', () => actionRequest('/api/stop', 'Stop output'));
logsBtn.addEventListener('click', async () => {
  try {
    const data = await fetchJson('/api/logs');
    setOutput(`Latest log output\n\n${data.output || 'No output returned.'}`);
  } catch (error) {
    setOutput(`Failed to load logs.\n${error.message}`);
  }
});

consoleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const command = consoleInput.value.trim();

  if (!command) {
    setOutput('Please enter a command to send to the server console.');
    return;
  }

  try {
    const data = await fetchJson('/api/console', {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
    setOutput(`Console output\n\n${data.output || 'No output returned.'}`);
    consoleInput.value = '';
    await refreshLiveData();
  } catch (error) {
    setOutput(`Console command failed.\n${error.message}`);
  }
});

refreshLiveData();
setInterval(refreshLiveData, LIVE_REFRESH_MS);
