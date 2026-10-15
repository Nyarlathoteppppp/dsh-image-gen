/**
 * Transport-failure diagnostics for provider fetches (#79).
 *
 * Node's undici reports the real reason behind a failed fetch (socket reset,
 * DNS, TLS, ...) only on `error.cause`, and the host's tool-error rendering
 * keeps just `.message` — so the conversation sees nothing but undici's bare
 * "fetch failed". These helpers rethrow transport failures with the failing
 * phase, elapsed seconds, and a bounded cause chain.
 */
import { redactSecrets } from './redact.js'

/** Cap a single transport-failure description so diagnostics cannot flood the conversation. */
const TRANSPORT_DETAIL_LIMIT = 600
/** How deep to walk `error.cause` chains; undici nests at most twice in practice. */
const CAUSE_CHAIN_DEPTH = 3

interface TransportContext {
  label: string
  signal: AbortSignal | undefined
  secrets: Array<string | undefined>
  startedAt: number
}

/** Keep body reads tied to the same request timing, cancellation, and secrets. */
const responseContexts = new WeakMap<Response, TransportContext>()

/**
 * Render one error plus its `cause` chain as a single line, e.g.
 * `TypeError: fetch failed <- Error [UND_ERR_SOCKET]: other side closed`.
 */
function describeErrorChain(error: unknown, depth = 0): string {
  if (depth >= CAUSE_CHAIN_DEPTH) return '...'
  if (error === undefined || error === null) return 'unknown transport error'
  if (typeof error === 'object') {
    const details = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown; kind?: unknown; reason?: unknown }
    if (error instanceof Error || typeof details.message === 'string') {
      const label = [typeof details.name === 'string' ? details.name : 'Error', typeof details.code === 'string' && details.code.length > 0 ? `[${details.code}]` : '']
        .filter(part => part.length > 0)
        .join(' ')
      const message = typeof details.message === 'string' ? details.message : ''
      const text = label.length > 0 && message.length > 0 ? `${label}: ${message}` : label || message
      return details.cause !== undefined && details.cause !== null && depth + 1 < CAUSE_CHAIN_DEPTH
        ? `${text} <- ${describeErrorChain(details.cause, depth + 1)}`
        : text || 'unknown transport error'
    }
    // DSH cancels tools with data objects such as { kind: 'user' } or
    // { kind: 'hook', reason: '...' }, rather than Error instances.
    if (typeof details.kind === 'string') {
      return details.reason === undefined || details.reason === null
        ? details.kind
        : `${details.kind}: ${describeErrorChain(details.reason, depth + 1)}`
    }
  }
  return String(error).trim() || 'unknown transport error'
}

/** One line describing why a provider fetch failed: the abort reason when the caller cancelled, the cause chain otherwise. */
export function describeTransportFailure(error: unknown, signal?: AbortSignal): string {
  try {
    if (signal?.aborted === true) {
      return `aborted (${describeErrorChain(signal.reason ?? error)})`
    }
    return describeErrorChain(error)
  } catch {
    // Thrown values and abort reasons can have hostile getters/toString().
    // Diagnostics must not replace the original failure with a formatter error.
    return 'unknown transport error'
  }
}

async function withTransportDiagnostics<T>(context: TransportContext, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const elapsed = ((performance.now() - context.startedAt) / 1000).toFixed(1)
    const detail = redactSecrets(describeTransportFailure(error, context.signal), ...context.secrets)
      .replace(/\s+/g, ' ').slice(0, TRANSPORT_DETAIL_LIMIT)
    throw new Error(`${context.label} failed after ${elapsed}s: ${detail}`, { cause: error })
  }
}

/**
 * Await one provider fetch and rethrow transport failures as
 * `${label} failed after 12.3s: ${cause chain}`. The original error stays
 * reachable on `cause` for host-side error rendering.
 */
export async function guardedFetch(
  label: string,
  signal: AbortSignal | undefined,
  run: () => Promise<Response>,
  ...secrets: Array<string | undefined>
): Promise<Response> {
  const context = { label, signal, secrets, startedAt: performance.now() }
  const response = await withTransportDiagnostics(context, run)
  responseContexts.set(response, context)
  return response
}

/** Guard only body I/O; parsing, HTTP checks and size enforcement stay with the adapter. */
export function readResponseBody<T>(response: Response, read: () => Promise<T>): Promise<T> {
  const context = responseContexts.get(response)
  return context === undefined ? read() : withTransportDiagnostics(context, read)
}
