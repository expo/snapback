# API proof: exact signature digest

Import from "snapback4/proof". Generated from dist declarations; types named below retain their declaration meaning.
Production: startServe(dir,{provisionUsers:{roles:{member:2,admin:2},provision:api.provision}}) returns host.sessions, shaped {member:[account,account],admin:[account,account]}. Account = {kind,role,email,password,principal,token,expiresAt}. Signup grants no role. The private persistent roster is production/proof-accounts/default.json (0600): {version:1,plan,entries:[{role,index,email,password,id,done,principal?,args?}]}; keep it with its store. provisionAccounts reuses this roster; freshUser creates an isolated proof identity instead. Read guide production --section "Serve script and reusable accounts" for partial-setup recovery; never read dist/proof.js.
Use probe:check for verification; probe:serve stays up until SIGTERM (deliberate harness run: --hold).

```ts
export function startDev(options?: ProofOptions | readonly string[]): Promise<DevHost>;
export function startServe(deployDir: string, options?: ServeOptions | readonly string[]): Promise<ServeHost>;
export interface ServeOptions extends ProofOptions { seedUsers?: SeedAccountsOptions; provisionUsers?: ProvisionAccountsOptions; clockOffset?: string; }
export interface ProofOptions { cwd?: string; env?: NodeJS.ProcessEnv; args?: readonly string[]; timeoutMs?: number; stopTimeoutMs?: number; logsDir?: string; secret?: boolean; detached?: boolean; livenessPipe?: boolean; processGroup?: boolean; }
export interface ProofHost { url: string; pid: number; logs: { stdout: string; stderr: string; }; stop(): Promise<void>; }
export interface DevHost extends ProofHost { devAccounts(options: SeedAccountsOptions): Promise<StagingSessions>; personas: string[]; now(): Promise<number>; advance(duration: string, options?: AdvanceOptions): Promise<ClockAdvance>; drain(options?: Pick<AdvanceOptions, "eachBoundary" | "allowHeld">): Promise<ClockAdvance>; operatorToken(service?: string, days?: number): Promise<string>; }
export interface ServeHost extends ProofHost { readonly deploymentDir: string; now(): Promise<number>; advance(duration: string, options?: AdvanceOptions): Promise<ClockAdvance>; drain(options?: Pick<AdvanceOptions, "eachBoundary" | "allowHeld">): Promise<ClockAdvance>; operatorToken(service?: string, days?: number): Promise<string>; seedAccounts(options: SeedAccountsOptions): Promise<StagingSessions>; provisionAccounts(options: ProvisionAccountsOptions): Promise<ProvisionedSessions>; sessions?: StagingSessions; }
export interface AdvanceOptions { eachBoundary?: boolean; drain?: boolean; allowHeld?: boolean; sessions?: "preserve" | "expire"; }
export function serveUntilSignal(hosts: readonly Pick<ProofHost, "stop">[]): Promise<void>;
export function deploy(dir: string, schema: string, options?: ProofOptions): Promise<CliResult>;
export function cli(args: readonly string[], options?: ProofOptions): Promise<CliResult>;
export interface CliResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; logs: ProofHost["logs"]; }
export function command(binary: string, args: readonly string[], options?: ProofOptions): Promise<CliResult>;
export function startStatic(dir: string, options?: ProofOptions): Promise<ProofHost>;
export function withBrowser<T>(options: LaunchOptions & Pick<ProofOptions, "cwd" | "logsDir"> & { chromium?: BrowserType; }, proof: (context: BrowserContext) => Promise<T>): Promise<T>;
export function renderedText(page: Page, text: string | RegExp, options?: { within?: Locator; exact?: boolean; } | null): Locator;
export function waitForFresh(locator: Locator, previous: string | null, options?: number | { within?: Locator; timeoutMs?: number; trigger?: () => unknown | Promise<unknown>; }): Promise<string>;
export function waitForServer<T>(read: () => Promise<T>, accepts: (value: T) => boolean, options?: { timeoutMs?: number; label?: string; }): Promise<T>;
export function fillRN(locator: Locator, value: string | Parameters<Locator["setInputFiles"]>[0]): Promise<void>;
export function labelledControl(page: Page, role: "textbox" | "combobox" | "checkbox" | "radio" | "spinbutton" | "slider" | "switch", name: string | RegExp, options?: { within?: Locator; exact?: boolean; }): Locator;
export function exhaustPages<Row>(readPage: (cursor: Cursor | null) => Promise<ProofPage<Row>>, options?: ExhaustPagesOptions): Promise<Row[]>;
export function snapshotAll<Row = Record<string, unknown>>(table: string, options?: ProofOptions & { release?: string; }): Promise<Row[]>;
export function cleanup(...steps: Array<(() => unknown | Promise<unknown>) | undefined>): Promise<void>;
export function bounded<T>(work: Promise<T>, ms: number, label: string): Promise<T>;
export function serveCheck(options: ServeCheckOptions): Promise<ServeCheckReport>;
export interface ServeCheckOptions { cwd?: string; env?: NodeJS.ProcessEnv; script?: string; deployment: string; timeoutMs?: number; upMs?: number; stopTimeoutMs?: number; then?: string | ((ready: ServeScriptReady, signal: AbortSignal) => unknown | Promise<unknown>); thenTimeoutMs?: number; }
export function provisionAccounts(host: Pick<ServeHost, "url" | "operatorToken"> & { deploymentDir?: string; }, options: ProvisionAccountsOptions): Promise<ProvisionedSessions>;
export interface ProvisionAccountsOptions extends SeedAccountsOptions { roster?: string; rosterDir?: string; }
export interface SeedAccountsOptions { roles?: Record<string, number>; provision?: { readonly name: string; }; users?: number; service?: string; args?: (account: StagingAccount) => Record<string, unknown>; timeoutMs?: number; }
export interface StagingAccount { kind: "user"; role: string; email: string; password: string; principal: string; token: string; expiresAt: number; }
export type StagingSessions = Record<string, StagingAccount[]>;
export type ProvisionedAccount = StagingAccount;
export function probeServeGuard(options?: { directory?: string; hold?: boolean; }): ProbeGuard;
export type ProvisionedSessions = StagingSessions;
export function uniqueName(prefix?: string): string;
export function freshUser(host: Pick<ServeHost, "url" | "operatorToken">, options?: FreshUserOptions): Promise<StagingAccount>;
export interface FreshUserOptions { role?: string; provision?: { readonly name: string; }; service?: string; args?: (account: StagingAccount) => Record<string, unknown>; timeoutMs?: number; }
```

Declaration fingerprint: 08e7a5e6802133ca49414b24c648a05caf4e364729ab1db34b0ee941e9af85eb
