"""
Production-Grade Redis Cache-Aside Implementation with Stampede Protection
==========================================================================
Demonstrates:
1. Cache-Aside pattern (Lazy Loading) with serialized JSON payloads.
2. TTL Jitter to prevent Cache Avalanche.
3. Cache Invalidation on write (Delete over Update pattern).
4. Distributed Mutex Lock (SET NX PX + Lua Unlock) to mitigate Cache Stampede.
5. Fail-Open resilience: Database fallback on Redis connectivity failures.

Dependencies:
    pip install redis
Python Version:
    >= 3.10
Redis Version:
    >= 6.2 (Tested on Redis 7.2 Alpine)
"""

import json
import logging
import random
import time
from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional
import redis
from redis.exceptions import RedisError

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("RedisCacheDemo")

# Atomic Lua release script: only release lock if token matches
LUA_RELEASE_LOCK = """
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
"""


@dataclass
class UserProfile:
    user_id: str
    username: str
    email: str
    tier: str
    updated_at: float


class MockDatabase:
    """Simulates a relational database (PostgreSQL/MySQL) with network latency."""

    def __init__(self):
        self._data: Dict[str, UserProfile] = {
            "usr_1001": UserProfile(
                user_id="usr_1001",
                username="alex_dev",
                email="alex@engineering.io",
                tier="Enterprise",
                updated_at=time.time(),
            )
        }
        self.db_query_count = 0

    def query_user(self, user_id: str) -> Optional[UserProfile]:
        # Simulate network and disk query latency (e.g., 40-60ms)
        self.db_query_count += 1
        time.sleep(0.05)
        return self._data.get(user_id)

    def update_user_tier(self, user_id: str, new_tier: str) -> Optional[UserProfile]:
        time.sleep(0.05)
        user = self._data.get(user_id)
        if user:
            user.tier = new_tier
            user.updated_at = time.time()
        return user


class ResilientCacheAsideService:
    def __init__(
        self,
        redis_client: redis.Redis,
        db: MockDatabase,
        base_ttl_sec: int = 60,
        jitter_range_sec: int = 15,
    ):
        self.redis = redis_client
        self.db = db
        self.base_ttl = base_ttl_sec
        self.jitter_range = jitter_range_sec
        self._release_lock_script = self.redis.register_script(LUA_RELEASE_LOCK)

    def _cache_key(self, user_id: str) -> str:
        return f"cache:users:{user_id}"

    def _lock_key(self, user_id: str) -> str:
        return f"lock:users:{user_id}"

    def _calculate_ttl(self) -> int:
        """Applies random jitter to base TTL to prevent simultaneous cache avalanche."""
        return self.base_ttl + random.randint(0, self.jitter_range)

    def get_user_profile(self, user_id: str) -> Optional[UserProfile]:
        """
        Retrieves user profile using Cache-Aside.
        Employs distributed mutex locking to prevent cache stampede upon key expiration.
        Fails open to DB if Redis encounters network failures.
        """
        key = self._cache_key(user_id)

        # 1. Attempt Cache Read
        try:
            cached_raw = self.redis.get(key)
            if cached_raw:
                data = json.loads(cached_raw)
                return UserProfile(**data)
        except RedisError as exc:
            # Fail-open: Redis failure should not crash the request pipeline
            logger.warning("Redis read error (%s). Falling back directly to DB.", exc)
            return self.db.query_user(user_id)

        # 2. Cache Miss: Acquire distributed mutex to prevent stampede
        lock_key = self._lock_key(user_id)
        lock_token = f"worker_{random.randint(100000, 999999)}"
        lock_acquired = False

        try:
            # SET lock:key token NX PX 5000 (expires in 5s to avoid permanent deadlock)
            lock_acquired = bool(self.redis.set(lock_key, lock_token, nx=True, px=5000))
        except RedisError:
            # If Redis locking errors out, fallback directly to DB query
            return self.db.query_user(user_id)

        if lock_acquired:
            try:
                # Double-check cache in case another worker populated it right before lock
                cached_raw = self.redis.get(key)
                if cached_raw:
                    data = json.loads(cached_raw)
                    return UserProfile(**data)

                # Fetch from primary database
                user = self.db.query_user(user_id)
                if user is not None:
                    ttl = self._calculate_ttl()
                    # Cache populated with TTL
                    self.redis.set(key, json.dumps(asdict(user)), ex=ttl)
                else:
                    # Cache null/negative with short TTL (30s) to prevent Cache Penetration
                    self.redis.set(key, json.dumps(None), ex=30)
                return user
            finally:
                # Safely release lock using atomic Lua script
                try:
                    self._release_lock_script(keys=[lock_key], args=[lock_token])
                except RedisError as exc:
                    logger.error("Failed to release lock %s: %s", lock_key, exc)
        else:
            # Another worker is already populating the cache; wait briefly and retry read
            time.sleep(0.06)  # 60ms wait (DB query takes ~50ms)
            try:
                cached_retry = self.redis.get(key)
                if cached_retry:
                    data = json.loads(cached_retry)
                    if data is None:
                        return None
                    return UserProfile(**data)
            except RedisError:
                pass

            # Fallback to DB if retry still missed
            return self.db.query_user(user_id)

    def update_user_tier(self, user_id: str, new_tier: str) -> Optional[UserProfile]:
        """
        Cache-Aside Write Path:
        1. Update DB first (source of truth).
        2. Invalidate (DEL) cache key immediately.
        Deleting rather than setting new value prevents race conditions under concurrency.
        """
        updated_user = self.db.update_user_tier(user_id, new_tier)
        if not updated_user:
            return None

        key = self._cache_key(user_id)
        try:
            self.redis.delete(key)
            logger.info("Invalidated cache key: %s", key)
        except RedisError as exc:
            # In production, enqueue to dead-letter queue or retry pipeline
            logger.error("Failed to invalidate cache key %s: %s", key, exc)

        return updated_user


if __name__ == "__main__":
    from concurrent.futures import ThreadPoolExecutor

    # Initialize connection to local Redis 7 instance
    r = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)
    r.flushdb()  # Start clean for verification

    db = MockDatabase()
    service = ResilientCacheAsideService(redis_client=r, db=db, base_ttl_sec=60)

    user_id = "usr_1001"
    print("\n--- 1. Verification of Cold Start (Cache Miss) ---")
    t0 = time.perf_counter()
    res1 = service.get_user_profile(user_id)
    t1 = time.perf_counter()
    print(f"Result: {res1.username} | Tier: {res1.tier}")
    print(f"Elapsed: {(t1 - t0)*1000:.2f}ms | DB Queries: {db.db_query_count}")

    print("\n--- 2. Verification of Hot Read (Cache Hit) ---")
    t0 = time.perf_counter()
    res2 = service.get_user_profile(user_id)
    t1 = time.perf_counter()
    print(f"Result: {res2.username} | Tier: {res2.tier}")
    print(f"Elapsed: {(t1 - t0)*1000:.2f}ms | DB Queries: {db.db_query_count}")

    print("\n--- 3. Verification of Invalidation on Write ---")
    service.update_user_tier(user_id, "VIP")
    print(f"Cache key exists in Redis: {bool(r.exists(service._cache_key(user_id)))}")

    print("\n--- 4. Verification of Read After Invalidation ---")
    t0 = time.perf_counter()
    res3 = service.get_user_profile(user_id)
    t1 = time.perf_counter()
    print(f"Result: {res3.username} | Tier: {res3.tier}")
    print(f"Elapsed: {(t1 - t0)*1000:.2f}ms | DB Queries: {db.db_query_count}")

    print("\n--- 5. Verification of Stampede Mutex Protection (10 Concurrent Readers) ---")
    # Invalidate cache to simulate sudden hot key expiration
    r.delete(service._cache_key(user_id))
    db_before = db.db_query_count

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(service.get_user_profile, user_id) for _ in range(10)]
        results = [f.result() for f in futures]

    db_after = db.db_query_count
    db_calls_during_stampede = db_after - db_before
    print(f"10 concurrent requests triggered {db_calls_during_stampede} database query (Target: 1).")
    print(f"All 10 workers returned valid data: {all(r.user_id == user_id for r in results)}")

    print("\n--- Verification Run Complete Successfully ---")
