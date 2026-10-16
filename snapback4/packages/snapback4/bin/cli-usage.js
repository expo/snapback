// @ref LLP 3000.000.000.000.000#4-cli-surface-contracts — the native CLI embeds this same command table; helper help needs no binary.
import { readFileSync } from 'node:fs';
const commands = JSON.parse(readFileSync(new URL('./cli-commands.json', import.meta.url), 'utf8'));
export function synopsis(verb) {
  const command = commands.find(command => command.verb === verb);
  if (!command) throw Error(`unknown command ${verb}`);
  return `snapback4 ${verb}${command.positional ? ` ${command.positional}` : ''}`
    + command.flags.filter(flag => !flag.retired).map(flag => ` [--${flag.name}${flag.value ? ` ${flag.value}` : ''}]`).join('');
}
