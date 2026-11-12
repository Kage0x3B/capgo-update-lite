/**
 * Browser clock for time labels. `ready` flips after mount so the server
 * render (UTC, server time) and the first client render match; local times
 * and "3m ago" labels appear right after hydration.
 */
export const clock = $state({ ready: false, now: Date.now() });

let started = false;

export function startClock(): () => void {
    clock.ready = true;
    clock.now = Date.now();
    if (started) return () => {};
    started = true;
    const id = setInterval(() => (clock.now = Date.now()), 15_000);
    return () => {
        clearInterval(id);
        started = false;
    };
}
