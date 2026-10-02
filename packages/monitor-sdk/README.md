# WebScope Monitor SDK

A TypeScript browser SDK for error, request, navigation and Web Vitals telemetry.

```ts
import { createMonitor } from '@webscope/monitor-sdk'

const monitor = createMonitor({
  appId: 'survey-platform',
  reportUrl: 'http://127.0.0.1:3301/api/events',
}).start()

monitor.captureError(new Error('Question save failed'), { questionId: 'demo' })
monitor.track('Survey published', { questionId: 'demo' })
await monitor.flush()
monitor.destroy()
```

## API

- `createMonitor(options)` / `new Monitor(options)` creates an inactive instance.
- `start()` installs collectors; repeated calls are idempotent.
- `captureError(reason, detail?)` supports Errors, strings and structured/cyclic reasons.
- `track(message, detail?)` records a custom behavior event.
- `captureEvent(type, message, detail?)` records a typed custom event for controlled integrations.
- `flush()` drains all eligible batches serially. Concurrent calls share the pending drain; future retry entries retain their delay.
- `getStatus()` returns `active`, `queued`, `sent`, `failed`, `dropped`, `beaconQueued` and `requests`.
- `subscribe(listener)` returns an unsubscribe function. `options.onStatus` also subscribes.
- `destroy()` removes SDK listeners/timers, stops collection and restores owned Fetch/XHR/History wrappers. Another library's newer wrappers are preserved.

Defaults: `batchSize: 10`, `flushInterval: 5000`, `maxQueueSize: 100`, `maxRetries: 3`, `breadcrumbLimit: 20`, `sampleRate: 1`.

## Data and reliability

The SDK captures runtime/rejection/resource errors, Fetch/XHR outcomes, navigation/click breadcrumbs and FCP/LCP/CLS/INP/TTFB using `web-vitals`. Request and response bodies, headers, input values and element text are never read. Common sensitive keys and URL query parameters are redacted. Review custom fields before sending them; regex filtering cannot identify every form of personal data.

Reports use `POST { appId, events }`, and require `{ accepted, duplicates }` acknowledgement. Network/5xx/429 failures retry after 1s/2s/4s, retaining event IDs for server deduplication. Other 4xx failures are dropped. The queue and payload size are bounded; overflow drops the oldest waiting event, and details exceeding 14KB become a truncated preview. Reporting uses the original Fetch and excludes the report endpoint from collection.

On `pagehide` or hidden visibility, the SDK uses `sendBeacon` with a 60KB payload limit, falling back to keepalive Fetch. A successful beacon return only means the browser queued it: `sent` is not incremented. Unacknowledged beacon entries may retry after visibility returns. Memory-only queues do not survive a full page reload; this version does not promise guaranteed delivery.

The public `web-vitals` API does not return disposal handles. Its callbacks are registered once and gated by the SDK's active state; `destroy()` prevents collection, while the library's page lifecycle observers may remain until their own finalization. Capture manual integration errors with `captureError` (for example, from a React ErrorBoundary).

## Commands

```sh
npm run build --workspace @webscope/monitor-sdk
npm run test --workspace @webscope/monitor-sdk
npm run typecheck --workspace @webscope/monitor-sdk
```
