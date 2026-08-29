import { ApplicationCommandOptionType, REST, Routes } from 'discord.js';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const { clientId, guildId, token } = config.discord;

const commands = [
  {
    name: 'status',
    description: 'Provides Status information about the Host Server.',
  },
  {
    name: 'run',
    description: 'Runs a command on the host machine and returns the output.',
    options: [
      {
        name: 'command',
        description: 'Command to run on the host machine',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
  {
    name: 'minecraft',
    description: 'Control and view the Minecraft server.',
  },
];

const rest = new REST({ version: '10' }).setToken(token);

async function deleteAllCommands(route) {
  const existingCommands = await rest.get(route);

  for (const command of existingCommands) {
    const deleteRoute = route.includes('/guilds/')
      ? Routes.applicationGuildCommand(clientId, guildId, command.id)
      : Routes.applicationCommand(clientId, command.id);

    await rest.delete(deleteRoute);
  }
}

try {
  await deleteAllCommands(Routes.applicationCommands(clientId));
  await deleteAllCommands(Routes.applicationGuildCommands(clientId, guildId));

  const route = Routes.applicationGuildCommands(clientId, guildId);

  console.log(`Started refreshing guild (/) commands for guild ${guildId}.`);
  await rest.put(route, { body: commands });

  console.log(`Successfully reloaded guild (/) commands for guild ${guildId}.`);
} catch (error) {
  console.error(error);
}