import { describe, it, expect, vi } from 'vitest';
import { MessageBus } from '../message-bus.js';

describe('MessageBus', () => {
  it('delivers messages to subscribers', () => {
    const bus = new MessageBus();
    const callback = vi.fn();
    bus.subscribe('test:channel', callback);
    bus.publish('test:channel', { value: 42 });

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'test:channel',
        payload: { value: 42 },
        timestamp: expect.any(Number),
      })
    );
  });

  it('does not deliver to unsubscribed listeners', () => {
    const bus = new MessageBus();
    const callback = vi.fn();
    const unsub = bus.subscribe('test:channel', callback);
    unsub();
    bus.publish('test:channel', { value: 1 });

    expect(callback).not.toHaveBeenCalled();
  });

  it('supports wildcard subscriptions', () => {
    const bus = new MessageBus();
    const callback = vi.fn();
    bus.subscribe('audio:*', callback);
    bus.publish('audio:features', { bass: 0.5 });
    bus.publish('audio:error', { message: 'fail' });
    bus.publish('math:compute', { data: [] });

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('does not throw when publishing to channel with no subscribers', () => {
    const bus = new MessageBus();
    expect(() => bus.publish('empty:channel', {})).not.toThrow();
  });

  it('replays last message to new subscribers', () => {
    const bus = new MessageBus();
    bus.publish('test:channel', { value: 1 });

    const callback = vi.fn();
    bus.subscribe('test:channel', callback, { replay: true });

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { value: 1 } })
    );
  });

  it('does not replay when replay option is false or unset', () => {
    const bus = new MessageBus();
    bus.publish('test:channel', { value: 1 });

    const callback = vi.fn();
    bus.subscribe('test:channel', callback);

    expect(callback).not.toHaveBeenCalled();
  });

  it('supports multiple subscribers on same channel', () => {
    const bus = new MessageBus();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    bus.subscribe('test:channel', cb1);
    bus.subscribe('test:channel', cb2);
    bus.publish('test:channel', { value: 1 });

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('never throws on publish even if subscriber throws', () => {
    const bus = new MessageBus();
    bus.subscribe('test:channel', () => { throw new Error('boom'); });
    const cb2 = vi.fn();
    bus.subscribe('test:channel', cb2);

    expect(() => bus.publish('test:channel', {})).not.toThrow();
    expect(cb2).toHaveBeenCalledOnce();
  });
});
