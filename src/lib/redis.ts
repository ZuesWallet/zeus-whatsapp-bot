import Redis from 'ioredis'

let client: Redis | null = null

export async function createRedisClient(): Promise<Redis> {
  if (client) return client

  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  client = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  })

  await client.ping()
  console.log('[Redis] Connected:', url)
  return client
}

export function getRedisClient(): Redis {
  if (!client) {
    throw new Error('Redis client not initialised — call createRedisClient() first')
  }
  return client
}
