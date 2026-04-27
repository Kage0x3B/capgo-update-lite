/**
 * Interactive prompts. Built on @clack/prompts so the bump flow gets a polished
 * UX (arrow-key select, Esc/Ctrl-C cancel detection) without rolling our own
 * readline state machine.
 *
 * Each helper folds clack's cancel sentinel into a regular return value
 * (null / false) so callers can stay in plain Promise<T | null> land instead
 * of branching on `isCancel`.
 */

import { confirm as clackConfirm, isCancel, select } from '@clack/prompts';
import { stdin } from 'node:process';
import type { BumpLevel } from './version-bump.js';

export function isInteractive(): boolean {
    return Boolean(stdin.isTTY);
}

/**
 * Bump-level picker for the publish autoresolve flow. "Cancel" is listed first
 * so a stray Enter on the default selection is the safe choice. Returns null
 * for either explicit Cancel or a clack cancel signal (Ctrl-C / Esc).
 */
export async function selectBumpLevel(currentVersion: string, channel: string): Promise<BumpLevel | null> {
    const choice = await select<BumpLevel | 'cancel'>({
        message: `Bundle version ${currentVersion} matches the active bundle on "${channel}" — what do you want to do?`,
        options: [
            { value: 'cancel', label: 'Cancel' },
            { value: 'patch', label: 'Increase patch version' },
            { value: 'minor', label: 'Increase minor version' },
            { value: 'major', label: 'Increase major version' }
        ],
        initialValue: 'cancel'
    });
    if (isCancel(choice) || choice === 'cancel') return null;
    return choice;
}

/**
 * Final yes/no gate after the bumped version is known. Defaulting to "no"
 * keeps a stray Enter from writing to package.json on autopilot.
 */
export async function confirmBump(from: string, to: string): Promise<boolean> {
    const result = await clackConfirm({
        message: `Bump version ${from} → ${to} and write package.json?`,
        initialValue: false
    });
    if (isCancel(result)) return false;
    return result;
}
