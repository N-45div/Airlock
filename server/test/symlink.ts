// Windows refuses to create symlinks unless Developer Mode is on or the shell is elevated (EPERM).
// Tests that need a symlink make it with trySymlink and skip with NO_SYMLINKS when they can't.

import { symlink } from 'node:fs/promises';

export const NO_SYMLINKS = 'this system refuses to create symlinks (Windows without Developer Mode)';

/** Creates a symlink; false only when Windows refuses for lack of permission. */
export async function trySymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    await symlink(target, linkPath);
    return true;
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  }
}
