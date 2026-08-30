import { Client, Events, GatewayIntentBits } from 'discord.js';
import fs from 'node:fs';
import commands from './commands/index.js';
import { startWebServer } from './webmanager/index.js';

const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function startBot() {
  client.on(Events.ClientReady, readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}!`);
  });

  client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isButton() && interaction.customId.startsWith('minecraft:')) {
      if (interaction.user.id !== config.permissions.allowedUserId) {
        await interaction.reply({
          content: '⚠ | You do not have permission to use this command!',
          ephemeral: true,
        });
        return;
      }

      try {
        const [, action] = interaction.customId.split(':');
        await commands.handleMinecraftButton(interaction, action);
      } catch (error) {
        console.error('Error handling Minecraft button:', error);
        await interaction.followUp({
          content: 'There was an error while handling that Minecraft action.',
          ephemeral: true,
        }).catch(() => {});
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'minecraft:console-submit') {
      if (interaction.user.id !== config.permissions.allowedUserId) {
        await interaction.reply({
          content: '⚠ | You do not have permission to use this command!',
          ephemeral: true,
        });
        return;
      }

      try {
        await commands.handleMinecraftConsoleSubmit(interaction);
      } catch (error) {
        console.error('Error handling Minecraft console command:', error);
        await interaction.editReply({
          content: 'There was an error while running the Minecraft console command.',
        }).catch(() => {});
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = commands[interaction.commandName];

    if (!command) return;

    if (interaction.user.id !== config.permissions.allowedUserId) {
      await interaction.reply({
        content: '⚠ | You do not have permission to use this command!',
        ephemeral: true,
      });
      return;
    }

    try {
      await command(interaction);
    } catch (error) {
      console.error(`Error running command ${interaction.commandName}:`, error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: 'There was an error while executing this command.',
        }).catch(() => {});
        return;
      }

      await interaction.reply({
        content: 'There was an error while executing this command.',
        ephemeral: true,
      }).catch(() => {});
    }
  });

  await client.login(config.discord.token);
}

async function main() {
  await startWebServer();
  await startBot();
}

main().catch(error => {
  console.error('Failed to start Remote Manager:', error);
  process.exit(1);
});