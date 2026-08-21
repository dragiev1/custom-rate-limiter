// For adaptability due to naming differences of increment and decrement functions
import { ClientRateLimitInfo, Store } from '../../../../src/types'
import { RedisStore } from 'rate-limit-redis'

class RedisAdapter implements Store {
    private externalStore: RedisStore

    constructor(options: any) {
        this.externalStore = new RedisStore(options)
    }

    async increment(key: string): Promise<ClientRateLimitInfo> {
        return this.externalStore.increment(key)
    }

    async decrement(key: string): Promise<void> {
        return this.externalStore.decrement(key)
    }

    async resetKey(key: string): Promise<void> {
        return this.externalStore.resetKey(key)
    }
}

export default RedisAdapter