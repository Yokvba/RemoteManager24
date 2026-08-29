import { run as statusCommand } from './status.js';
import { run as runCommand } from './run.js';
import { handleButton as handleMinecraftButton, handleConsoleSubmit as handleMinecraftConsoleSubmit, run as minecraftCommand } from './minecraft.js';

export default {
  status: statusCommand,
  run: runCommand,
  minecraft: minecraftCommand,
  handleMinecraftButton,
  handleMinecraftConsoleSubmit,
};
