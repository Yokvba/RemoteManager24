import { EmbedBuilder } from 'discord.js';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const { host: targetHost, port: targetPort } = config.socket;
let lastNetworkSnapshot = null;

function tcpPing(host, port) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const socket = net.connect(port, host, () => {
      const ping = Date.now() - start;
      socket.destroy();
      resolve(ping);
    });

    socket.on('error', (error) => {
      reject(error);
    });
  });
}

function getCpuUsage() {
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

function getRamUsage() {
  const totalGb = os.totalmem() / 1024 / 1024 / 1024;
  const freeGb = os.freemem() / 1024 / 1024 / 1024;
  const usedGb = totalGb - freeGb;

  return {
    usedGb: Number(usedGb.toFixed(2)),
    totalGb: Number(totalGb.toFixed(2)),
  };
}

async function getRawNetworkStats() {
  const platform = os.platform();

  if (platform === 'linux') {
    const data = fs.readFileSync('/proc/net/dev', 'utf8');
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

async function getNetworkUsage() {
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

function formatNetworkRate(mbps) {
  if (mbps < 1) {
    return `${(mbps * 1000).toFixed(2)} Kbps`;
  }

  return `${mbps.toFixed(2)} Mbps`;
}

export async function run(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const updateStatus = async (index = 0) => {
    try {
      const ping = await tcpPing(targetHost, targetPort);
      const cpu = await getCpuUsage();
      const ram = getRamUsage();
      const network = await getNetworkUsage();

      const embed = new EmbedBuilder()
        .setColor('#00FF7F')
        .setTitle('🟢 Host Status')
        .setDescription('Host Server is online and reachable.')
        .addFields(
          { name: 'Socket', value: `${targetHost}:${targetPort}`, inline: true },
          { name: 'Status', value: 'Online', inline: true },
          { name: 'Ping', value: `${ping}ms`, inline: true },
          { name: 'CPU', value: `${cpu}%`, inline: true },
          { name: 'RAM', value: `${ram.usedGb} GB / ${ram.totalGb} GB`, inline: true },
          { name: 'Network', value: `↓ ${formatNetworkRate(network.down)} / ↑ ${formatNetworkRate(network.up)}`, inline: true }
        )
        .setTimestamp();

      if (index === 0) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({ embeds: [embed] });
      }
    } catch {
      const offlineEmbed = new EmbedBuilder()
        .setColor('#FF4D4D')
        .setTitle('🔴 Host Status')
        .setDescription('Host Server is offline or unreachable.')
        .addFields(
          { name: 'Socket', value: `${targetHost}:${targetPort}`, inline: true },
          { name: 'Status', value: 'Offline', inline: true },
          { name: 'Ping', value: 'N/A', inline: true },
          { name: 'CPU', value: 'N/A', inline: true },
          { name: 'RAM', value: 'N/A', inline: true },
          { name: 'Network', value: 'N/A', inline: true }
        )
        .setTimestamp();

      if (index === 0) {
        await interaction.editReply({ embeds: [offlineEmbed] });
      } else {
        await interaction.editReply({ embeds: [offlineEmbed] });
      }
    }

    if (index < 5) {
      setTimeout(() => updateStatus(index + 1), 1000);
    }
  };

  await updateStatus(0);
}