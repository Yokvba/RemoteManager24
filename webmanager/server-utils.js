import { exec, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config, minecraftConfig } from './config.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const { screenName, serverPath } = minecraftConfig;
const { host: targetHost, port: targetPort } = config.socket || {};
const { forbiddenCommands = [] } = config;
let lastNetworkSnapshot = null;

export function outputText(stdout, stderr) {
  return (stdout || '').trim() || (stderr || '').trim() || 'Command completed successfully.';
}

export function isForbiddenCommand(command) {
  const normalized = command.trim().toLowerCase();
  return forbiddenCommands.some((forbidden) => normalized.includes(forbidden.toLowerCase()));
}

export function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function tcpPing(host, port) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const socket = net.connect(port, host, () => {
      const ping = Date.now() - start;
      socket.destroy();
      resolve(ping);
    });

    socket.on('error', reject);
  });
}

export function getCpuUsage() {
  return new Promise((resolve) => {
    const start = os.cpus().map((cpu) => ({
      user: cpu.times.user,
      nice: cpu.times.nice,
      sys: cpu.times.sys,
      idle: cpu.times.idle,
      irq: cpu.times.irq,
    }));

    setTimeout(() => {
      const end = os.cpus();
      let totalDiff = 0;
      let idleDiff = 0;

      for (let i = 0; i < end.length; i++) {
        const startCpu = start[i];
        const endCpu = end[i];
        const startTotal = Object.values(startCpu).reduce((sum, value) => sum + value, 0);
        const endTotal = Object.values(endCpu.times).reduce((sum, value) => sum + value, 0);
        const diffTotal = endTotal - startTotal;
        const diffIdle = endCpu.times.idle - startCpu.idle;

        totalDiff += diffTotal;
        idleDiff += diffIdle;
      }

      const usage = totalDiff === 0 ? 0 : ((totalDiff - idleDiff) / totalDiff) * 100;
      resolve(Number(usage.toFixed(1)));
    }, 250);
  });
}

export function getRamUsage() {
  const totalGb = os.totalmem() / 1024 / 1024 / 1024;
  const freeGb = os.freemem() / 1024 / 1024 / 1024;
  const usedGb = totalGb - freeGb;

  return {
    usedGb: Number(usedGb.toFixed(2)),
    totalGb: Number(totalGb.toFixed(2)),
  };
}

export function getUptime() {
  const seconds = os.uptime();
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

export async function getRawNetworkStats() {
  const platform = os.platform();

  if (platform === 'linux') {
    const data = await fs.readFile('/proc/net/dev', 'utf8');
    const lines = data.split('\n').slice(2);

    let downBytes = 0;
    let upBytes = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(/\s+/);
      const iface = parts[0].replace(':', '');
      if (!iface || iface === 'lo') continue;

      downBytes += Number(parts[1]) || 0;
      upBytes += Number(parts[9]) || 0;
    }

    return { downBytes, upBytes };
  }

  if (platform === 'win32') {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "$stats = Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | Measure-Object -Property BytesReceivedPerSec,BytesSentPerSec -Sum; if ($stats) { Write-Output \"$($stats[0].Sum) $($stats[1].Sum)\" } else { Write-Output \"0 0\" }"'
    );

    const [downBytes, upBytes] = stdout.trim().split(/\s+/).map(Number);
    return {
      downBytes: Number.isFinite(downBytes) ? downBytes : 0,
      upBytes: Number.isFinite(upBytes) ? upBytes : 0,
    };
  }

  return { downBytes: 0, upBytes: 0 };
}

export async function getNetworkUsage() {
  const current = await getRawNetworkStats();

  if (!lastNetworkSnapshot) {
    lastNetworkSnapshot = { ...current, timestamp: Date.now() };
    return { up: 0, down: 0 };
  }

  const elapsedSeconds = Math.max((Date.now() - lastNetworkSnapshot.timestamp) / 1000, 0.1);
  const downMbps = ((current.downBytes - lastNetworkSnapshot.downBytes) * 8) / (1000000 * elapsedSeconds);
  const upMbps = ((current.upBytes - lastNetworkSnapshot.upBytes) * 8) / (1000000 * elapsedSeconds);

  lastNetworkSnapshot = { ...current, timestamp: Date.now() };

  return {
    down: Math.max(0, downMbps),
    up: Math.max(0, upMbps),
  };
}

export function formatNetworkRate(mbps) {
  if (mbps < 1) {
    return `${(mbps * 1000).toFixed(2)} Kbps`;
  }

  return `${mbps.toFixed(2)} Mbps`;
}

export async function getDiskUsage() {
  try {
    const { stdout } = await execAsync('df -k /dev/sda1 2>/dev/null || df -k / 2>/dev/null || df -k . 2>/dev/null || wmic logicaldisk get size,freespace /format:csv 2>nul', { timeout: 5000, windowsHide: true });

    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const dataLine = lines.find((line) => {
      if (line.startsWith('Filesystem') || line.startsWith('FreeSpace') || line.startsWith('Name')) {
        return false;
      }

      const parts = line.split(/\s+/);
      return parts.length >= 4 && /^\d+$/.test(parts[1] || '');
    });

    if (dataLine) {
      const parts = dataLine.split(/\s+/);
      const totalK = Number(parts[1]);
      const usedK = Number(parts[2]);
      const availK = Number(parts[3]);
      const percentText = String(parts[4] || '0').replace('%', '');
      const percent = Number(percentText);

      if (Number.isFinite(totalK) && Number.isFinite(usedK)) {
        const totalGb = Number((totalK / 1024 / 1024).toFixed(2));
        const usedGb = Number((usedK / 1024 / 1024).toFixed(2));
        const usagePercent = Number.isFinite(percent)
          ? percent
          : totalK > 0
            ? (usedK / totalK) * 100
            : 0;

        return {
          diskUsed: usedGb,
          diskTotal: totalGb,
          diskPercent: Number(usagePercent.toFixed(1)),
        };
      }
    }

    return { diskUsed: 0, diskTotal: 0, diskPercent: 0 };
  } catch {
    return { diskUsed: 0, diskTotal: 0, diskPercent: 0 };
  }
}

export async function getHostStatus() {
  const socket = targetHost && targetPort ? `${targetHost}:${targetPort}` : 'N/A';

  try {
    const ping = await tcpPing(targetHost, targetPort);
    const cpu = await getCpuUsage();
    const ram = getRamUsage();
    const network = await getNetworkUsage();
    const disk = await getDiskUsage();
    const uptime = getUptime();

    return {
      socket,
      online: true,
      status: 'Online',
      ping: `${ping}ms`,
      cpu: `${cpu}%`,
      ram: `${ram.usedGb} GB / ${ram.totalGb} GB`,
      diskUsed: disk.diskUsed,
      diskTotal: disk.diskTotal,
      diskPercent: disk.diskPercent,
      uptime: uptime,
      network: `↓ ${formatNetworkRate(network.down)} / ↑ ${formatNetworkRate(network.up)}`,
    };
  } catch {
    return {
      socket,
      online: false,
      status: 'Offline',
      ping: 'N/A',
      cpu: 'N/A',
      ram: 'N/A',
      diskUsed: 0,
      diskTotal: 0,
      diskPercent: 0,
      uptime: getUptime(),
      network: 'N/A',
    };
  }
}

export async function isScreenAvailable() {
  try {
    await execAsync('screen --version', { timeout: 2000, windowsHide: true });
    return true;
  } catch (error) {
    return false;
  }
}

export async function isServerOnline() {
  if (!(await isScreenAvailable())) {
    return false;
  }

  const normalizedName = String(screenName || '').trim();
  if (!normalizedName) {
    return false;
  }

  const candidateNames = new Set([
    normalizedName,
    normalizedName.replace(/^\./, ''),
    normalizedName.replace(/\s+/g, ''),
  ]);

  try {
    const { stdout, stderr } = await execAsync('screen -ls', { timeout: 5000, windowsHide: true });
    const combined = `${stdout || ''}\n${stderr || ''}`;
    const lines = combined.split(/\r?\n/);

    const matched = lines.some((line) => {
      const value = line.trim();
      if (!value) return false;

      return Array.from(candidateNames).some((candidate) => {
        const normalized = candidate.toLowerCase();
        return value.toLowerCase().includes(normalized) || value.toLowerCase().includes(`.${normalized}`);
      });
    });

    if (matched) {
      return true;
    }
  } catch (error) {
    const combined = `${error.stdout || ''}\n${error.stderr || ''}`;
    const lines = combined.split(/\r?\n/);
    const matched = lines.some((line) => {
      const value = line.trim();
      if (!value) return false;

      return Array.from(candidateNames).some((candidate) => {
        const normalized = candidate.toLowerCase();
        return value.toLowerCase().includes(normalized) || value.toLowerCase().includes(`.${normalized}`);
      });
    });

    if (matched) {
      return true;
    }
  }

  try {
    const { stdout } = await execAsync(
      `ps -eo pid,comm,args --no-headers | grep -Ei "screen|java|minecraft" | grep -F "${normalizedName}"`,
      { timeout: 5000, windowsHide: true }
    );
    return Boolean((stdout || '').trim());
  } catch {
    return false;
  }
}

export async function runCommand(command) {
  try {
    const result = await execAsync(command, { timeout: 15000, windowsHide: true });
    return outputText(result.stdout, result.stderr);
  } catch (error) {
    const output = outputText(error.stdout, error.stderr);
    return output === 'Command completed successfully.' ? error.message : output;
  }
}

export async function getLatestLogs() {
  const logDir = path.resolve('/tmp');
  await fs.mkdir(logDir, { recursive: true }).catch(() => {});

  const logFile = path.join(logDir, `${screenName}-screen-${process.pid}-${Date.now()}.log`);

  try {
    await execFileAsync('screen', ['-S', screenName, '-X', 'hardcopy', '-h', logFile], {
      timeout: 5000,
      windowsHide: true,
    });
    await wait(100);

    const log = await fs.readFile(logFile, 'utf8');
    const lines = log.trimEnd().split(/\r?\n/).slice(-20).join('\n');
    return lines || 'No log output returned.';
  } catch (error) {
    return error.message || 'Unable to read the server log.';
  } finally {
    await fs.rm(logFile, { force: true }).catch(() => {});
  }
}

export async function sendConsoleCommand(command) {
  const trimmed = (command || '').trim();

  if (!trimmed) {
    return 'No command was provided.';
  }

  await execFileAsync('screen', ['-S', screenName, '-p', '0', '-X', 'stuff', `${trimmed}\r`], {
    timeout: 5000,
    windowsHide: true,
  });

  await wait(400);
  return getLatestLogs();
}

export async function runHostCommand(command) {
  const trimmed = (command || '').trim();

  if (!trimmed) {
    throw new Error('No command was provided.');
  }

  if (isForbiddenCommand(trimmed)) {
    throw new Error('This command is blocked by policy.');
  }

  try {
    const result = await execAsync(trimmed, { timeout: 15000, windowsHide: true });
    const output = outputText(result.stdout, result.stderr);
    return output || 'Command completed successfully.';
  } catch (error) {
    const output = outputText(error.stdout, error.stderr);
    return output || error.message || 'Command failed.';
  }
}

export function getStartCommand() {
  return `cd ${serverPath} && ./start.sh`;
}

export function getStopCommand() {
  return `screen -X -S ${screenName} quit`;
}
