import { EmbedBuilder } from 'discord.js';
import { exec } from 'node:child_process';

import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const { allowedUserId } = config.permissions;
const { forbiddenCommands } = config;

function isForbiddenCommand(command) {
  const normalized = command.trim().toLowerCase();
  return forbiddenCommands.some((forbidden) => normalized.includes(forbidden.toLowerCase()));
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    if (isForbiddenCommand(command)) {
      reject('This command is blocked by policy.');
      return;
    }

    exec(command, { timeout: 15000, windowsHide: true }, (error, stdout, stderr) => {
      const output = (stdout || '').trim() || (stderr || '').trim();

      if (error && !output) {
        reject(error.message);
        return;
      }

      resolve({
        ok: !error,
        output: output || (error ? error.message : 'Command completed successfully.'),
      });
    });
  });
}

export async function run(interaction) {
  if (interaction.user.id !== allowedUserId) {
    await interaction.reply({
      content: '⚠ | You do not have permission to use this command!',
      ephemeral: true,
    });
    return;
  }

  const command = interaction.options.getString('command', true);

  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await runCommand(command);
    const output = result.output.length > 1800 ? `${result.output.slice(0, 1800)}...` : result.output;

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🖥️ Command Output')
      .setDescription(`\`\`\`\n${output}\n\`\`\``)
      .addFields({ name: 'Command', value: `\`\`${command}\`\``, inline: false })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const embed = new EmbedBuilder()
      .setColor('#ED4245')
      .setTitle('⚠️ Command Error')
      .setDescription(`\`\`\`\n${String(error)}\n\`\`\``)
      .addFields({ name: 'Command', value: `\`\`${command}\`\``, inline: false })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
}
