export type ConsoleSubscription = {
  subscriptionId: string;
  sessionId: string;
  hostId: string;
  paneId: string;
  createdAt: number;
};

class ConsoleSubscriptionStore {
  private subs: Map<string, ConsoleSubscription> = new Map();

  add(sub: Omit<ConsoleSubscription, 'createdAt'>): void {
    this.subs.set(sub.subscriptionId, { ...sub, createdAt: Date.now() });
  }

  remove(subscriptionId: string): void {
    this.subs.delete(subscriptionId);
  }

  getByHost(hostId: string): ConsoleSubscription[] {
    const result: ConsoleSubscription[] = [];
    for (const sub of this.subs.values()) {
      if (sub.hostId === hostId) {
        result.push(sub);
      }
    }
    return result;
  }
}

export const consoleSubscriptions = new ConsoleSubscriptionStore();
