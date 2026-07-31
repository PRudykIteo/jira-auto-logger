import { app } from 'electron'
import type { AppConfig } from '@shared/domain'
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
 * sessions, app version, OS and locale to each event - that already yields
 * active-user and version counts; we add a `worklogs_created` event carrying
 * only a count and total hours, a propless `report_generated` event, a `theme`
 * prop on `app_started`, and an `env` prop on every event. No issue keys,
 * descriptions or credentials are sent.
 *
 * Note: `dev` (unpackaged) runs are tagged `isDebug: true` by the SDK, so their
 * events appear only under the Aptabase dashboard's "Debug" filter, not the
 * default Release view.
 */
export class TelemetryService {
  private initialized = false
  private readConfig: () => AppConfig | null = () => null

  private get appKey(): string {
    return process.env.JAL_APTABASE_KEY?.trim() || APTABASE_APP_KEY
  }

  /**
   * Bind the live config source once it is available (after app ready). It is
   * read lazily per event, so both the opt-out and reported attributes (theme)
   * always reflect the current config with no restart.
   */
  bindConfig(readConfig: () => AppConfig): void {
    this.readConfig = readConfig
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

  /**
   * Fired once on launch so users who never log time still count as active.
   * Carries the active `theme` - a per-session attribute (like the SDK's own
   * OS/version), so theme adoption is a breakdown of this event.
   */
  start(): void {
    const config = this.readConfig()
    void this.track('app_started', config ? { theme: config.themeId } : undefined)
  }

  /** One event per successful worklog submission; hours rounded to keep it coarse. */
  trackWorklogsCreated(count: number, hours: number): void {
    void this.track('worklogs_created', { count, hours: Math.round(hours * 100) / 100 })
  }

  /**
   * One bare event per generated monthly PDF report - deliberately without props:
   * we only want to know that reports are being used, not how they were shaped.
   */
  trackReportGenerated(): void {
    void this.track('report_generated')
  }

  /** Telemetry sends only when initialized (has key, not mock) and opted in. */
  private get active(): boolean {
    const config = this.readConfig()
    return this.initialized && config !== null && config.telemetry.enabled
  }

  /**
   * `env` rides on every event so any event type (including `worklogs_created`)
   * can be filtered by it: `development`/`production` from `app.isPackaged`,
   * overridable with `JAL_TELEMETRY_ENV` (e.g. `test`), so dev/test traffic
   * filters out of real stats. This is on top of Aptabase's own `isDebug` split
   * of unpackaged runs. Per-session attributes like `theme` ride on
   * `app_started` instead, not here.
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
