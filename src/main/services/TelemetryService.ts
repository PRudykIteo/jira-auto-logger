import { app } from 'electron'
import { initialize, trackEvent } from '@aptabase/electron/main'
import { isMockMode } from './mock'
import { logger } from './logger'

/**
 * Aptabase app key. These keys are meant to be embedded in the distributed
 * client (they are write-only, not a secret), so baking it in is expected. The
 * region is encoded in the key (`A-EU-…`). Override with `JAL_APTABASE_KEY`,
 * and point at a self-hosted instance with `JAL_APTABASE_HOST`.
 */
const APTABASE_APP_KEY = 'A-EU-3600777036'

/**
 * Anonymous, opt-out usage telemetry via Aptabase. All reporting happens in the
 * main process (the renderer has no `ipcRenderer` under contextIsolation), so
 * the renderer never needs the SDK. Aptabase automatically attributes anonymous
 * sessions, app version and OS to each event - that already yields active-user
 * and version counts; we add a single `worklogs_created` event carrying only a
 * count and total hours. No issue keys, descriptions or credentials are sent.
 *
 * Note: `dev` (unpackaged) runs are tagged `isDebug: true` by the SDK, so their
 * events appear only under the Aptabase dashboard's "Debug" filter, not the
 * default Release view.
 */
export class TelemetryService {
  private initialized = false
  private isEnabled: () => boolean = () => false

  private get appKey(): string {
    return process.env.JAL_APTABASE_KEY?.trim() || APTABASE_APP_KEY
  }

  /**
   * Set the opt-out source once config is available (after app ready). Reading
   * it lazily per event means toggling the setting takes effect immediately,
   * with no restart.
   */
  bindConfig(isEnabled: () => boolean): void {
    this.isEnabled = isEnabled
  }

  /**
   * MUST be called before the app 'ready' event: Aptabase's `initialize`
   * disables itself (and registers a privileged protocol scheme) if the app is
   * already ready. It performs no network I/O on its own - nothing leaves the
   * machine until an event is tracked - so it is safe to initialize regardless
   * of the opt-out state; actual reporting is gated per event in `track()`.
   * Initializing unconditionally is also what lets the setting be toggled on at
   * runtime without a restart.
   */
  init(): void {
    if (this.initialized || !this.appKey || isMockMode()) return
    const host = process.env.JAL_APTABASE_HOST?.trim()
    void initialize(this.appKey, host ? { host } : undefined)
    this.initialized = true
  }

  /** Fired once on launch so users who never log time still count as active. */
  start(): void {
    void this.track('app_started')
  }

  /** One event per successful worklog submission; hours rounded to keep it coarse. */
  trackWorklogsCreated(count: number, hours: number): void {
    void this.track('worklogs_created', { count, hours: Math.round(hours * 100) / 100 })
  }

  /** Telemetry sends only when initialized (has key, not mock) and opted in. */
  private get active(): boolean {
    return this.initialized && this.isEnabled()
  }

  /**
   * Attached to every event so dev/test traffic is trivially filterable in the
   * dashboard. Defaults from `app.isPackaged` (dev runs → `development`) but can
   * be forced with `JAL_TELEMETRY_ENV`, e.g. to mark a packaged build you run
   * locally as `test` so it never pollutes production stats. This is on top of
   * Aptabase's own `isDebug` flag (which also splits unpackaged runs out).
   */
  private get commonProps(): Record<string, string> {
    return { env: process.env.JAL_TELEMETRY_ENV?.trim() || (app.isPackaged ? 'production' : 'development') }
  }

  private async track(name: string, props?: Record<string, string | number | boolean>): Promise<void> {
    if (!this.active) return
    try {
      await trackEvent(name, { ...this.commonProps, ...props })
    } catch (e) {
      // Telemetry is best-effort and must never affect the app.
      logger.debug('telemetry', `event "${name}" failed`, e instanceof Error ? e.message : String(e))
    }
  }
}
