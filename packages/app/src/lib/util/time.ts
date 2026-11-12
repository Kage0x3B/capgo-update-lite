/** Time formatting for the explorer. Local time zone once the browser clock runs. */
import { clock } from './clock.svelte.js';

export type TimeMode = 'relative' | 'local' | 'utc';

export function ago(iso: string, now: number): string {
    const s = Math.round((now - new Date(iso).getTime()) / 1000);
    if (s < 0) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ${m % 60}m ago`;
    return `${Math.floor(h / 24)}d ago`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local time once the clock is running in the browser; UTC during SSR. */
export function localStamp(iso: string, withMs = false): string {
    if (!clock.ready) return utcStamp(iso) + (withMs ? iso.slice(19, 23) : '');
    const d = new Date(iso);
    const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return withMs ? `${base}.${String(d.getMilliseconds()).padStart(3, '0')}` : base;
}

export function utcStamp(iso: string): string {
    return iso.slice(0, 19).replace('T', ' ');
}

export function fmtTime(iso: string, mode: TimeMode): string {
    if (!clock.ready) return utcStamp(iso);
    if (mode === 'relative') return ago(iso, clock.now);
    if (mode === 'local') return localStamp(iso);
    return utcStamp(iso);
}

/** `<input type="datetime-local">` value for an ISO instant, in local time. */
export function toLocalInput(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | undefined {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
