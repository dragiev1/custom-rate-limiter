import { agent as request } from 'supertest'
import memcachedStore from '../src/memcached-store'
import redisStore from '../src/redis-store'
import mongoStore from '../src/mongo-store'
import { test } from '@jest/globals'

test.each([
    ['redis', redisStore],
    ['mongo', mongoStore],
    ['memcached', memcachedStore],
])('should work for %s store', async (_name, app) => {
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(429)
})