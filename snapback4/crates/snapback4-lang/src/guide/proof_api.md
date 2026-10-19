## Proof API (generated from source)

Every runtime and type export of `snapback4/proof` is listed below. Signatures, result fields and failure reasons are generated from TypeScript declarations and their @throws comments; qualification checks this table against the source. Playwright types such as Page and Locator come from playwright-core.

| Signature | Result / fields | Failure reasons |
|---|---|---|
| `bounded<T>(work: Promise<T>, ms: number, label: string): Promise<T>` | `Awaited<T>` | deadline expires; work rejection propagates. |
| `cleanup(...steps: Array<(() => unknown \| Promise<unknown>) \| undefined>): Promise<void>` | `void` | AggregateError after every cleanup was attempted; each step has a 10-second bound. |
| `cli(args: readonly string[], options?: ProofOptions): Promise<CliResult>` | `{ code: number \| null; signal: NodeJS.Signals \| null; stdout: string; stderr: string; logs: { stdout: string; stderr: string; } }` | spawn error or command deadline; nonzero exit is returned in code, not thrown. |
| `command(binary: string, args: readonly string[], options?: ProofOptions): Promise<CliResult>` | `{ code: number \| null; signal: NodeJS.Signals \| null; stdout: string; stderr: string; logs: { stdout: string; stderr: string; } }` | spawn error or command deadline; nonzero exit is returned in code, not thrown. |
| `deploy(dir: string, schema: string, options?: ProofOptions): Promise<CliResult>` | `{ code: number \| null; signal: NodeJS.Signals \| null; stdout: string; stderr: string; logs: { stdout: string; stderr: string; } }` | missing explicit saved source, CLI failure, spawn error or deadline. |
| `fillRN(locator: Locator, text: string): Promise<void>` | `void` | locator ambiguity, disabled/closed control, or Playwright deadline. |
| `frontPage(page: Page): Promise<Page>` | `Page` | page closed or browser activation failed. |
| `loadFixtures(directory: string, options: LoadFixturesOptions): Promise<FixtureRow[]>` | `Array of { table: string; row: Record<string, unknown> }` | E_PROOF_USAGE for missing url or invalid timeout; E_AUTH naming attempted credential; catalog, clock, filesystem, row JSON/table or E_FIXTURE_TIME validation failure. |
| `logsDir(options?: Pick<ProofOptions, "cwd" \| "logsDir">): string` | `string` | None; returns the resolved explicit or cwd/logs path. |
| `portRange(env?: NodeJS.ProcessEnv): string` | `string` | partial, invalid or reversed PORT_LO/PORT_HI pair. |
| `renderedText(page: Page, text: string \| RegExp, options?: { within?: Locator; exact?: boolean; }): Locator` | `Locator` | None at construction; locator observation can refuse ambiguous or invalid selectors. |
| `rollback(dir: string, to: number \| "latest", options?: ProofOptions): Promise<CliResult>` | `{ code: number \| null; signal: NodeJS.Signals \| null; stdout: string; stderr: string; logs: { stdout: string; stderr: string; } }` | invalid explicit release target, CLI failure, spawn error or deadline. |
| `sandboxUnavailable(error: unknown): boolean` | `false or true` | None; returns a boolean for recognized sandbox launch errors. |
| `seedAccounts(host: Pick<ServeHost, "url" \| "operatorToken">, options: SeedAccountsOptions): Promise<StagingSessions>` | `StagingSessions` | E_STAGING_INPUT for invalid plans; E_STAGING for production/dev hosts; E_STAGING_TIMEOUT, E_STAGING_SIGNUP or E_STAGING_PROVISION for incomplete setup. Partial accounts/grants may exist; inspect or discard the staging store before retrying. |
| `selectByValue(locator: Locator, value: string): Promise<void>` | `void` | locator ambiguity, unavailable option or Playwright deadline. |
| `startDev(options?: ProofOptions \| readonly string[]): Promise<DevHost>` | `{ personas: string[]; now: () => Promise<number>; url: string; pid: number; logs: { stdout: string; stderr: string; }; stop: () => Promise<void> }` | invalid port range or conflicting memory flags; child exits, readiness deadline, PID/served identity mismatch, or unavailable dev clock. |
| `startServe(deployDir: string, options?: ServeOptions \| readonly string[]): Promise<ServeHost>` | `ServeHost` | E_PROOF_USAGE for missing deployment directory; child exit, readiness deadline or served identity mismatch. |
| `startStatic(dir: string, options?: ProofOptions): Promise<ProofHost>` | `{ url: string; pid: number; logs: { stdout: string; stderr: string; }; stop: () => Promise<void> }` | missing export/index or build script precondition; exhausted ports, readiness deadline or served identity mismatch. |
| `startVite(dir: string, options?: ProofOptions): Promise<ProofHost>` | `{ url: string; pid: number; logs: { stdout: string; stderr: string; }; stop: () => Promise<void> }` | missing Vite dependency/configuration; exhausted ports, readiness deadline or served identity mismatch. |
| `statusText(page: Page, text?: string \| RegExp): Locator` | `Locator` | None at construction; ambiguous text is refused when observed. |
| `stopChild(child: ChildProcess \| Pick<ProofHost, "url" \| "stop">, graceMs?: number): Promise<void>` | `void` | invalid handle/deadline, host stop failure or TERM/KILL reap deadline. |
| `testSource(source: string, options?: TestSourceOptions): Promise<TestSourceResult>` | `{ casesRun: number; casesSkipped: number; code: number \| null; signal: NodeJS.Signals \| null; stdout: string; stderr: string; logs: { stdout: string; stderr: string; } }` | missing source, CLI failure, invalid business-case summary or zero cases without fixtureOnly. |
| `waitForClock(page: Page, advancedNow: number, options?: { timeoutMs?: number; }): Promise<number>` | `number` | E_PROOF_USAGE for invalid advanced time; missing/disabled witness, signed-out client, page error or page-clock deadline. |
| `waitForFresh(locator: Locator, previous: string \| null, options?: number \| { within?: Locator; timeoutMs?: number; }): Promise<string>` | `string` | observation deadline with scoped locator, last text and visible headings; selector ambiguity is propagated. |
| `waitForServer<T>(read: () => Promise<T>, accepts: (value: T) => boolean, options?: { timeoutMs?: number; label?: string; }): Promise<T>` | `Awaited<T>` | deadline naming label and last value; read or predicate errors propagate. |
| `withBrowser<T>(options: LaunchOptions & Pick<ProofOptions, "cwd" \| "logsDir"> & { chromium?: BrowserType; }, proof: (context: BrowserContext) => Promise<T>): Promise<T>` | `Awaited<T>` | E_PROOF_BROWSER for missing playwright-core; invalid deadline, browser launch failure or callback error; bounded context/browser cleanup failure. |

| Exported type | Fields |
|---|---|
| `CliResult` | `{ code: number \| null; signal: NodeJS.Signals \| null; stdout: string; stderr: string; logs: { stdout: string; stderr: string; } }` |
| `DevHost` | `{ personas: string[]; now: () => Promise<number>; url: string; pid: number; logs: { stdout: string; stderr: string; }; stop: () => Promise<void> }` |
| `FixtureRow` | `{ table: string; row: Record<string, unknown> }` |
| `LoadFixturesOptions` | `url: string; cwd?: string; persona?: string; headers?: Record<string, string>; now?: number; timeoutMs?: number` |
| `ProofHost` | `{ url: string; pid: number; logs: { stdout: string; stderr: string; }; stop: () => Promise<void> }` |
| `ProofOptions` | `cwd?: string; env?: NodeJS.ProcessEnv; args?: readonly string[]; timeoutMs?: number; stopTimeoutMs?: number; logsDir?: string; secret?: boolean; detached?: boolean; livenessPipe?: boolean` |
| `SeedAccountsOptions` | `roles: Record<string, number>; provision: { readonly name: string; }; service?: string; args?: (account: StagingAccount) => Record<string, unknown>; timeoutMs?: number` |
| `ServeHost` | `now: () => Promise<number>; advance: (duration: string, options?: { eachBoundary?: boolean; }) => Promise<number>; operatorToken: (service?: string, days?: number) => Promise<string>; seedAccounts: (options: SeedAccountsOptions) => Promise<StagingSessions>; sessions?: StagingSessions; url: string; pid: number; logs: { stdout: string; stderr: string; }; stop: () => Promise<void>` |
| `ServeOptions` | `seedUsers?: SeedAccountsOptions; clockOffset?: string; cwd?: string; env?: NodeJS.ProcessEnv; args?: readonly string[]; timeoutMs?: number; stopTimeoutMs?: number; logsDir?: string; secret?: boolean; detached?: boolean; livenessPipe?: boolean` |
| `StagingAccount` | `role: string; email: string; password: string; principal: string; token: string; expiresAt: number` |
| `StagingSessions` | `` |
| `TestSourceOptions` | `fixtureOnly?: boolean; cwd?: string; env?: NodeJS.ProcessEnv; args?: readonly string[]; timeoutMs?: number; stopTimeoutMs?: number; logsDir?: string; secret?: boolean; detached?: boolean; livenessPipe?: boolean` |
| `TestSourceResult` | `{ casesRun: number; casesSkipped: number; code: number \| null; signal: NodeJS.Signals \| null; stdout: string; stderr: string; logs: { stdout: string; stderr: string; } }` |
