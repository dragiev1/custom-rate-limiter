// For bridging the incompatiable naming differences with increment and decrement methods
import { ClientRateLimitInfo, Store } from '../../../../src/types'
import { MemcachedStore } from 'rate-limit-memcached'

class MemcachedAdapter implements Store {
    private externalStore: MemcachedStore;

    constructor(options: any) {
        this.externalStore = new MemcachedStore(options)
    }

    async increment(key: string): Promise<ClientRateLimitInfo> {
        return this.externalStore.increment(key)
    }

    async decrement(key: string): Promise<void> {
        return this.externalStore.decrement(key)
    }

    async resetKey(key: string): Promise<void> {
        this.externalStore.resetKey(key)
    }
}

export default MemcachedAdapter