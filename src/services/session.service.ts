import { getRedisClient } from '../lib/redis'
import type { Session } from '../types'

const SESSION_TTL = 600 // 10 minutes
const SESSION_KEY = (phone: string, partnerId: string) => `wa_session:${phone}:${partnerId}`

const EMPTY_SESSION: Session = { flow: null, step: null, data: {} }

export class SessionService {
  async get(phone: string, partnerId: string): Promise<Session> {
    const redis = getRedisClient()
    const raw = await redis.get(SESSION_KEY(phone, partnerId))
    if (!raw) return { ...EMPTY_SESSION, data: {} }
    return JSON.parse(raw) as Session
  }

  async set(phone: string, partnerId: string, session: Session): Promise<void> {
    const redis = getRedisClient()
    await redis.set(SESSION_KEY(phone, partnerId), JSON.stringify(session), 'EX', SESSION_TTL)
  }

  async clear(phone: string, partnerId: string): Promise<void> {
    const redis = getRedisClient()
    await redis.del(SESSION_KEY(phone, partnerId))
  }

  async extendTTL(phone: string, partnerId: string): Promise<void> {
    const redis = getRedisClient()
    await redis.expire(SESSION_KEY(phone, partnerId), SESSION_TTL)
  }
}
