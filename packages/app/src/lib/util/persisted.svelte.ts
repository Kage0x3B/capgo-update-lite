/**
 * A $state value mirrored to localStorage. Starts with `initial` so server
 * and first client render match; call `load()` from onMount / $effect to pick
 * up the stored value. Storage errors (private mode, quota) are ignored.
 */
export class Persisted<T> {
    #key: string;
    #value = $state() as T;

    constructor(key: string, initial: T) {
        this.#key = key;
        this.#value = initial;
    }

    get value(): T {
        return this.#value;
    }

    set value(v: T) {
        this.#value = v;
        try {
            localStorage.setItem(this.#key, JSON.stringify(v));
        } catch {
            /* ignore */
        }
    }

    load(merge?: (stored: unknown, initial: T) => T): void {
        try {
            const raw = localStorage.getItem(this.#key);
            if (raw === null) return;
            const parsed = JSON.parse(raw) as unknown;
            this.#value = merge ? merge(parsed, this.#value) : (parsed as T);
        } catch {
            /* ignore */
        }
    }
}
