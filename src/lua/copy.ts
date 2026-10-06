/**
 * "Copy Lua library": put `MAPPER_LUA` on the clipboard and say so. Used by the panel's ☰ menu and the
 * `mapper.copyLua` command; one place so the toast wording and the fallback stay the same.
 */
import type { Mu } from '@muclient/sdk';
import { MAPPER_LUA } from './library';

export const COPY_LUA_LABEL = 'Copy Lua library';

export async function copyLuaLibrary(mu: Mu): Promise<boolean> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  try {
    if (!clip) throw new Error('no clipboard');
    await clip.writeText(MAPPER_LUA);
    mu.ui.toast('Lua library copied', 'Paste it into a startup script (Settings → Scripts), then use mapper.* in triggers and aliases', { kind: 'mapper' });
    return true;
  } catch (e) {
    mu.ui.toast('Could not copy', `${e instanceof Error ? e.message : String(e)}. The library is in docs/lua.md of the package.`, { kind: 'mapper' });
    return false;
  }
}
