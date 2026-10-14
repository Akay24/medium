<!--
NOTE: Created by the article-pipeline scaffolding as a PLACEHOLDER request for
the end-to-end Redis caching run (M10). It is authored for this project, not a
preserved editorial asset. Edit freely before running the pipeline.
-->

# Article request: Redis caching

## Topic

An engineer-focused article on using Redis as a cache for read-heavy backend
services: where caching helps, cache-aside vs write-through patterns, TTL
strategy, stampede protection basics, and the operational failure modes that
surprise teams (hot keys, eviction, and stale reads).

## Audience

Backend engineers with 1-3 years of experience who have used a key-value store
but have not designed a caching layer themselves.

## Working thesis

Caching with Redis is an availability and latency trade, not a free win: the
value comes from deliberate TTLs and stampede protection, and the risks
(stale reads, eviction storms) must be engineered for, not discovered in
production.

## Source URLs (manual research mode)

- https://redis.io/docs/latest/develop/use/client-side-caching/
- https://redis.io/docs/latest/commands/set/
- https://redis.io/docs/latest/develop/data-types/strings/

## Constraints

- Medium article, roughly 1200-1800 words of prose.
- One runnable TypeScript example using node-redis (run spec: redis-basic).
- At least one Mermaid diagram of the cache-aside flow.
- No first-person testing claims; the author has not benchmarked this setup.
