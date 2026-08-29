import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { exec, execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const { screenName, serverPath, webUrl } = config.minecraft;
const serverCommand = `cd ${serverPath} && ./start.sh`;
const stopCommand = `screen -X -S ${screenName} quit`;
const statusCommand = 'screen -ls';

const topRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('minecraft:start')
    .setLabel('▶ Start')
    .setStyle(ButtonStyle.Success),
  new ButtonBuilder()
    .setCustomId('minecraft:stop')
    .setLabel('⏹ Stop')
    .setStyle(ButtonStyle.Danger),
  new ButtonBuilder()
    .setCustomId('minecraft:log')
    .setLabel('📝 Current Log')
    .setStyle(ButtonStyle.Secondary)
);

const bottomRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('minecraft:console')
    .setLabel('💬 Console')
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setLabel('🌐 Web')
    .setStyle(ButtonStyle.Link)
    .setURL(webUrl)
);

const buttonRows = [topRow, bottomRow];

const consoleModal = new ModalBuilder()
  .setCustomId('minecraft:console-submit')
  .setTitle('Minecraft Console')
  .addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('minecraft:console-command')
        .setLabel('Command')
        .setPlaceholder('say Hello, world!')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(500)
    )
  );

async function isServerOnline() {
  try {
    const { stdout, stderr } = await execAsync(statusCommand, { timeout: 5000, windowsHide: true });
    return `${stdout}\n${stderr}`.includes(screenName);
  } catch (error) {
    return `${error.stdout || ''}\n${error.stderr || ''}`.includes(screenName);
  }
}

function outputText(stdout, stderr) {
  return (stdout || '').trim() || (stderr || '').trim() || 'Command completed successfully.';
}

function limitOutput(output) {
  return output.length > 1000 ? `...${output.slice(-997)}` : output;
}

async function createEmbed(action = null, output = null) {
  const online = await isServerOnline();
  const embed = new EmbedBuilder()
    .setColor(online ? '#57F287' : '#ED4245')
    .setTitle('Minecraft Server')
    .setDescription(`Status: ${online ? 'Online' : 'Offline'}`)
    .addFields({ name: 'Screen session', value: online ? `\`${screenName}\` is running` : `\`${screenName}\` is not running` });

  if (action) {
    embed.addFields({ name: action, value: `\`\`\`\n${limitOutput(output || 'No output returned.')}\n\`\`\`` });
  }

  return embed.setTimestamp();
}

async function execute(command) {
  try {
    const result = await execAsync(command, { timeout: 15000, windowsHide: true });
    return outputText(result.stdout, result.stderr);
  } catch (error) {
    const output = outputText(error.stdout, error.stderr);
    return output === 'Command completed successfully.' ? error.message : output;
  }
}

async function getLatestLogs() {
  const logFile = `/tmp/${screenName}-screen-${process.pid}-${Date.now()}.log`;

  try {
    await execFileAsync('screen', ['-S', screenName, '-X', 'hardcopy', '-h', logFile], {
      timeout: 5000,
      windowsHide: true,
    });
    await wait(100);

    const log = await fs.promises.readFile(logFile, 'utf8');
    const lines = log.trimEnd().split(/\r?\n/).slice(-5).join('\n');
    return lines || 'No log output returned.';
  } catch (error) {
    return error.message;
  } finally {
    await fs.promises.rm(logFile, { force: true }).catch(() => {});
  }
}

async function updateLogs(interaction, index = 0) {
  const output = await getLatestLogs();
  await interaction.editReply({
    embeds: [await createEmbed(`Latest log output (refresh ${index + 1}/11)`, output)],
    components: buttonRows,
  });

  if (index < 10) {
    setTimeout(() => updateLogs(interaction, index + 1).catch(() => {}), 1000);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendConsoleCommand(command) {
  await execFileAsync('screen', ['-S', screenName, '-p', '0', '-X', 'stuff', `${command}\r`], {
    timeout: 5000,
    windowsHide: true,
  });
  await wait(500);
  return getLatestLogs();
}

export async function run(interaction) {
  await interaction.reply({
    embeds: [await createEmbed()],
    components: buttonRows,
    ephemeral: true,
  });
}

export async function handleButton(interaction, action) {
  if (action === 'console') {
    await interaction.showModal(consoleModal);
    return;
  }

  await interaction.deferUpdate();

  if (action === 'start') {
    const output = await execute(serverCommand);
    await interaction.editReply({ embeds: [await createEmbed('Start output', output)], components: buttonRows });
    return;
  }

  if (action === 'stop') {
    const output = await isServerOnline()
      ? await execute(stopCommand)
      : 'No `mcserver` screen session was found. The stop command was not run.';
    await interaction.editReply({ embeds: [await createEmbed('Stop output', output)], components: buttonRows });
    return;
  }

  if (action === 'log') {
    await updateLogs(interaction);
  }
}

export async function handleConsoleSubmit(interaction) {
  const command = interaction.fields.getTextInputValue('minecraft:console-command').trim();
  await interaction.deferUpdate();

  if (!await isServerOnline()) {
    await interaction.editReply({
      embeds: [await createEmbed('Console output', `No \`${screenName}\` screen session was found. The command was not sent.`)],
      components: buttonRows,
    });
    return;
  }

  try {
    const output = await sendConsoleCommand(command);
    await interaction.editReply({
      embeds: [await createEmbed('Console output', output)],
      components: buttonRows,
    });
  } catch (error) {
    await interaction.editReply({
      embeds: [await createEmbed('Console error', error.message)],
      components: buttonRows,
    });
  }
}