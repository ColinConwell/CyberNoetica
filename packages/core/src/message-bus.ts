import type { BusMessage, Channel, Unsubscribe } from './types.js';

type Callback<T = unknown> = (message: BusMessage<T>) => void;

interface SubscribeOptions {
  /** If true, immediately deliver the last message on this channel */
  replay?: boolean;
}

export class MessageBus {
  private subscribers = new Map<Channel, Set<Callback>>();
  private wildcardSubscribers = new Map<string, Set<Callback>>();
  private lastMessage = new Map<Channel, BusMessage>();

  subscribe<T = unknown>(
    channel: Channel,
    callback: Callback<T>,
    options?: SubscribeOptions,
  ): Unsubscribe {
    const cb = callback as Callback;

    if (channel.endsWith(':*')) {
      const prefix = channel.slice(0, -1);
      if (!this.wildcardSubscribers.has(prefix)) {
        this.wildcardSubscribers.set(prefix, new Set());
      }
      this.wildcardSubscribers.get(prefix)!.add(cb);

      return () => {
        this.wildcardSubscribers.get(prefix)?.delete(cb);
      };
    }

    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel)!.add(cb);

    if (options?.replay && this.lastMessage.has(channel)) {
      try {
        cb(this.lastMessage.get(channel)!);
      } catch {
        // Subscriber errors never propagate
      }
    }

    return () => {
      this.subscribers.get(channel)?.delete(cb);
    };
  }

  publish<T = unknown>(channel: Channel, payload: T): void {
    const message: BusMessage<T> = {
      channel,
      payload,
      timestamp: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    };

    this.lastMessage.set(channel, message as BusMessage);

    const subs = this.subscribers.get(channel);
    if (subs) {
      for (const cb of subs) {
        try {
          cb(message as BusMessage);
        } catch {
          // Subscriber errors never propagate
        }
      }
    }

    for (const [prefix, wildcardSubs] of this.wildcardSubscribers) {
      if (channel.startsWith(prefix)) {
        for (const cb of wildcardSubs) {
          try {
            cb(message as BusMessage);
          } catch {
            // Subscriber errors never propagate
          }
        }
      }
    }
  }
}
