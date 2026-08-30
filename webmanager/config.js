import fs from 'node:fs/promises';

export const config = JSON.parse(
  await fs.readFile(new URL('../config.json', import.meta.url), 'utf8')
);

export const webConfig = config.web || {};
export const minecraftConfig = config.minecraft || {};
