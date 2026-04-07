import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../store.js';

interface TestState {
  count: number;
  nested: { a: number; b: string };
  flags: { active: boolean };
}

const INITIAL: TestState = {
  count: 0,
  nested: { a: 1, b: 'hello' },
  flags: { active: false },
};

describe('Store', () => {
  it('returns initial state', () => {
    const store = createStore(INITIAL);
    expect(store.getState()).toEqual(INITIAL);
  });

  it('does not mutate initial state object', () => {
    const init = { ...INITIAL, nested: { ...INITIAL.nested }, flags: { ...INITIAL.flags } };
    const store = createStore(init);
    store.setState({ count: 99 });
    expect(init.count).toBe(0);
  });

  it('applies shallow partial updates', () => {
    const store = createStore(INITIAL);
    store.setState({ count: 5 });
    expect(store.getState().count).toBe(5);
    expect(store.getState().nested.a).toBe(1);
  });

  it('deep merges nested objects', () => {
    const store = createStore(INITIAL);
    store.setState({ nested: { a: 42 } });
    const s = store.getState();
    expect(s.nested.a).toBe(42);
    expect(s.nested.b).toBe('hello');
  });

  it('notifies subscribers on setState', () => {
    const store = createStore(INITIAL);
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 1 });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
  });

  it('unsubscribes correctly', () => {
    const store = createStore(INITIAL);
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    store.setState({ count: 1 });
    expect(listener).toHaveBeenCalledOnce();

    unsub();
    store.setState({ count: 2 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('select fires only when selected value changes', () => {
    const store = createStore(INITIAL);
    const listener = vi.fn();
    store.select(s => s.count, listener);

    store.setState({ nested: { a: 99 } });
    expect(listener).not.toHaveBeenCalled();

    store.setState({ count: 10 });
    expect(listener).toHaveBeenCalledWith(10);
  });

  it('serializes and deserializes', () => {
    const store = createStore(INITIAL);
    store.setState({ count: 42, flags: { active: true } });

    const json = store.serialize();
    const parsed = JSON.parse(json);
    expect(parsed.count).toBe(42);
    expect(parsed.flags.active).toBe(true);

    const store2 = createStore(INITIAL);
    store2.deserialize(json);
    expect(store2.getState().count).toBe(42);
    expect(store2.getState().flags.active).toBe(true);
  });

  it('ignores invalid JSON on deserialize', () => {
    const store = createStore(INITIAL);
    store.setState({ count: 5 });
    store.deserialize('not valid json');
    expect(store.getState().count).toBe(5);
  });

  it('deserialize merges into existing state', () => {
    const store = createStore(INITIAL);
    store.setState({ count: 5, flags: { active: true } });
    store.deserialize(JSON.stringify({ count: 99 }));
    const s = store.getState();
    expect(s.count).toBe(99);
    expect(s.flags.active).toBe(true);
  });

  it('empty setState does not change state identity but notifies', () => {
    const store = createStore(INITIAL);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState({});
    expect(listener).toHaveBeenCalledOnce();
  });

  it('swallows subscriber errors', () => {
    const store = createStore(INITIAL);
    store.subscribe(() => { throw new Error('boom'); });
    const second = vi.fn();
    store.subscribe(second);

    expect(() => store.setState({ count: 1 })).not.toThrow();
    expect(second).toHaveBeenCalled();
  });
});
