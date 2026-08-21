import { MemcachedStore } from "rate-limit-memcached";
import { ClientRateLimitInfo, Store } from "../../../../src/types";

class MemcachedAdapter implements Store {
    private externalStore: MemcachedStore

    constructor(options: any) {
        this.externalStore = new MemcachedStore(options)
    }

    async increment(key: string): Promise<ClientRateLimitInfo> { return this.externalStore.increment(key) }
    async decrement(key: string): Promise<void> { return this.externalStore.decrement(key) }
    async resetKey(key: string): Promise<void> { return this.externalStore.resetKey(key) }
}

export default MemcachedAdapter