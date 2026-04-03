export interface Store<T> {
  getState(): Readonly<T>;
  setState(partial: DeepPartial<T>): void;
  subscribe(listener: (state: Readonly<T>) => void): () => void;
  select<S>(selector: (state: Readonly<T>) => S, listener: (selected: S) => void): () => void;
  serialize(): string;
  deserialize(json: string): void;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepMerge<T extends Record<string, any>>(target: T, source: DeepPartial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sv = source[key];
    if (sv !== undefined && typeof sv === 'object' && sv !== null && !Array.isArray(sv)
        && typeof target[key] === 'object' && target[key] !== null) {
      result[key] = deepMerge(target[key] as any, sv as any);
    } else if (sv !== undefined) {
      result[key] = sv as T[keyof T];
    }
  }
  return result;
}

export function createStore<T extends Record<string, any>>(initial: T): Store<T> {
  let state: T = structuredClone(initial);
  const listeners = new Set<(state: Readonly<T>) => void>();

  function getState(): Readonly<T> {
    return state;
  }

  function setState(partial: DeepPartial<T>): void {
    state = deepMerge(state, partial);
    for (const listener of listeners) {
      try { listener(state); } catch { /* listener errors don't propagate */ }
    }
  }

  function subscribe(listener: (state: Readonly<T>) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function select<S>(
    selector: (state: Readonly<T>) => S,
    listener: (selected: S) => void,
  ): () => void {
    let prev = selector(state);
    return subscribe((s) => {
      const next = selector(s);
      if (next !== prev) {
        prev = next;
        listener(next);
      }
    });
  }

  function serialize(): string {
    return JSON.stringify(state);
  }

  function deserialize(json: string): void {
    try {
      const parsed = JSON.parse(json);
      setState(parsed);
    } catch { /* invalid JSON, ignore */ }
  }

  return { getState, setState, subscribe, select, serialize, deserialize };
}
