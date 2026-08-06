import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {useSnapbackConnection, type SnapbackConnection} from '@expo/snapback-react';

import {api} from '../../snapback/generated/api.mjs';
import {
  fetchLoginBootstrap,
  type LoginBootstrapExchange,
} from './login-bootstrap';

// @ref LLP 0059#transition-barrier — authExchange advances browser custody
// through the coordinator barrier; only the successor handshake and
// principal-derived identity query may publish a current user.

export type SessionIdentity = Readonly<{
  principal: string;
  sourceUserID: string;
  githubID: number;
  login: string;
  role: 'crew' | 'user';
}>;

export type SessionHandshake = Readonly<{
  activeMode?: string;
  authority?: Readonly<{
    kind?: string;
    isAuthenticated?: boolean;
    userId?: string | null;
  }>;
  authorityDescriptor?: Readonly<{
    authorityInstanceId?: string;
    sessionGeneration?: number;
  }>;
  authorizationStreamIncarnation?: string;
}>;

export type OfflineFact = 'online' | 'degraded' | 'offline' | 'unknown';

export type SessionSnapshot = Readonly<{
  phase: 'loading' | 'anonymous' | 'authenticated' | 'transitioning' | 'error';
  session: SessionHandshake | null;
  current: SessionIdentity | null;
  connection: SnapbackConnection;
  offline: OfflineFact;
  error: Readonly<{code: string; message: string}> | null;
}>;

export type SessionClient = Readonly<{
  authSession(options?: Readonly<{force?: boolean}>): Promise<SessionHandshake | null>;
  authExchange(exchange: LoginBootstrapExchange): Promise<unknown>;
  authLogout(): Promise<unknown>;
  replaceBearerToken(token: string | null): Promise<void>;
  query(
    reference: unknown,
    options: Readonly<{args: Readonly<Record<string, never>>}>,
  ): Promise<Readonly<{rows: readonly unknown[]}>>;
}>;

export type SessionControllerOptions = Readonly<{
  client: SessionClient;
  loginBasePath?: string;
  loadLoginBootstrap?: () => Promise<LoginBootstrapExchange | null>;
  navigate?: (url: string) => void;
}>;

export type SessionAuthorityIdentity = Readonly<{
  phase: SessionSnapshot['phase'];
  principal: string | null;
  authorityInstanceId: string | null;
  sessionGeneration: number | null;
  authorizationStreamIncarnation: string | null;
}>;

function offlineFact(connection: SnapbackConnection): OfflineFact {
  switch (connection) {
    case 'live':
      return 'online';
    case 'polling':
    case 'stale':
      return 'degraded';
    case 'disconnected':
    case 'closed':
    case 'error':
      return 'offline';
    case 'idle':
    case 'connecting':
      return 'unknown';
  }
}

function safeError(error: unknown): Readonly<{code: string; message: string}> {
  const candidate = error as {code?: unknown; message?: unknown; diagnostic?: {code?: unknown}} | null;
  return Object.freeze({
    code: typeof candidate?.diagnostic?.code === 'string'
      ? candidate.diagnostic.code
      : typeof candidate?.code === 'string' ? candidate.code : 'ZBUGS_SESSION_ERROR',
    message: typeof candidate?.message === 'string' ? candidate.message : String(error),
  });
}

function identity(value: unknown): SessionIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('gateway identity row must be an object');
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.principal !== 'string'
    || typeof row.sourceUserID !== 'string'
    || !Number.isSafeInteger(row.githubID)
    || typeof row.login !== 'string'
    || (row.role !== 'crew' && row.role !== 'user')
  ) throw new TypeError('gateway identity row is malformed');
  return Object.freeze({
    principal: row.principal,
    sourceUserID: row.sourceUserID,
    githubID: row.githubID as number,
    login: row.login,
    role: row.role,
  });
}

function isAuthenticated(session: SessionHandshake | null): boolean {
  return session?.authority?.isAuthenticated === true
    || session?.authority?.kind === 'session';
}

/** The authority-bearing portion of a server-backed query/window identity. */
export function sessionAuthorityIdentity(snapshot: SessionSnapshot): SessionAuthorityIdentity {
  return Object.freeze({
    phase: snapshot.phase,
    principal: snapshot.phase === 'authenticated' ? snapshot.current?.principal ?? null : null,
    authorityInstanceId: snapshot.session?.authorityDescriptor?.authorityInstanceId ?? null,
    sessionGeneration: snapshot.session?.authorityDescriptor?.sessionGeneration ?? null,
    authorizationStreamIncarnation: snapshot.session?.authorizationStreamIncarnation ?? null,
  });
}

export class SessionController {
  readonly #client: SessionClient;
  readonly #loginBasePath: string;
  readonly #loadLoginBootstrap: () => Promise<LoginBootstrapExchange | null>;
  readonly #navigate: (url: string) => void;
  #bootstrapFlight: Promise<void> | null = null;
  #generation = 0;
  #activeFlows = new Set<number>();
  #listeners = new Set<() => void>();
  #snapshot: SessionSnapshot = Object.freeze({
    phase: 'loading',
    session: null,
    current: null,
    connection: 'idle',
    offline: 'unknown',
    error: null,
  });

  constructor(options: SessionControllerOptions) {
    this.#client = options.client;
    this.#loginBasePath = options.loginBasePath ?? '/api/login/github';
    this.#loadLoginBootstrap = options.loadLoginBootstrap ?? fetchLoginBootstrap;
    this.#navigate = options.navigate ?? (url => {
      if (typeof window !== 'undefined') window.location.assign(url);
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.#snapshot;

  #publish(next: Omit<SessionSnapshot, 'connection' | 'offline'>): void {
    this.#snapshot = Object.freeze({
      ...next,
      connection: this.#snapshot.connection,
      offline: offlineFact(this.#snapshot.connection),
    });
    for (const listener of this.#listeners) listener();
  }

  setConnection(connection: SnapbackConnection): void {
    if (connection === this.#snapshot.connection) return;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      connection,
      offline: offlineFact(connection),
    });
    for (const listener of this.#listeners) listener();
  }

  blank(): void {
    this.#generation += 1;
    this.#publish({
      phase: 'transitioning',
      session: null,
      current: null,
      error: null,
    });
  }

  #beginFlow(phase: 'loading' | 'transitioning'): number {
    const generation = ++this.#generation;
    this.#activeFlows.add(generation);
    this.#publish({phase, session: null, current: null, error: null});
    return generation;
  }

  #finishFlow(generation: number): void {
    this.#activeFlows.delete(generation);
    if (
      (this.#snapshot.phase === 'loading' || this.#snapshot.phase === 'transitioning')
      && !this.#activeFlows.has(this.#generation)
    ) {
      this.#publish({
        phase: 'error',
        session: null,
        current: null,
        error: Object.freeze({
          code: 'ZBUGS_SESSION_FLOW_ABANDONED',
          message: 'the session transition ended without a terminal successor publication',
        }),
      });
    }
  }

  #publishError(generation: number, error: unknown): void {
    if (generation !== this.#generation) return;
    this.#publish({phase: 'error', session: null, current: null, error: safeError(error)});
  }

  async refresh(options: Readonly<{blank?: boolean}> = {}): Promise<void> {
    const generation = this.#beginFlow(options.blank ? 'transitioning' : 'loading');
    try {
      await this.#refreshGeneration(generation);
    } catch (error) {
      this.#publishError(generation, error);
    } finally {
      this.#finishFlow(generation);
    }
  }

  bootstrap(): Promise<void> {
    if (this.#bootstrapFlight !== null) return this.#bootstrapFlight;
    const flight = this.#bootstrapOnce().finally(() => {
      if (this.#bootstrapFlight === flight) this.#bootstrapFlight = null;
    });
    this.#bootstrapFlight = flight;
    return flight;
  }

  async #bootstrapOnce(): Promise<void> {
    const generation = this.#beginFlow('loading');
    try {
      const exchange = await this.#loadLoginBootstrap();
      if (generation !== this.#generation) return;
      if (exchange !== null) {
        this.#publish({phase: 'transitioning', session: null, current: null, error: null});
        await this.#client.authExchange(exchange);
        // Custody has advanced: a concurrent authSession refresh can bump the
        // generation mid-exchange with a pre-exchange snapshot (observed live:
        // GET /auth/session interleaving the exchange POST). The exchange
        // outcome must still settle — claim a fresh generation instead of
        // abandoning the UI in 'transitioning'.
        const settled = ++this.#generation;
        this.#activeFlows.add(settled);
        try {
          await this.#refreshGeneration(settled);
        } finally {
          this.#finishFlow(settled);
        }
        return;
      }
      await this.#refreshGeneration(generation);
    } catch (error) {
      this.#publishError(generation, error);
    } finally {
      this.#finishFlow(generation);
    }
  }

  async #refreshGeneration(generation: number): Promise<void> {
    const session = await this.#client.authSession({force: true});
    if (generation !== this.#generation) return;
    if (!isAuthenticated(session)) {
      this.#publish({phase: 'anonymous', session, current: null, error: null});
      return;
    }
    const output = await this.#client.query(api.gatewayIdentitySelf, {args: {}});
    if (generation !== this.#generation) return;
    if (output.rows.length !== 1) {
      throw new TypeError('gateway identity query must return exactly one row');
    }
    this.#publish({
      phase: 'authenticated',
      session,
      current: identity(output.rows[0]),
      error: null,
    });
  }

  login(redirect?: string): string {
    this.blank();
    const fallback = typeof window === 'undefined'
      ? '/'
      : `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const target = `${this.#loginBasePath}?redirect=${encodeURIComponent(redirect ?? fallback)}`;
    this.#navigate(target);
    return target;
  }

  async logout(): Promise<void> {
    const generation = this.#beginFlow('transitioning');
    try {
      await this.#client.authLogout();
      if (generation !== this.#generation) return;
      const session = await this.#client.authSession({force: true});
      if (generation !== this.#generation) return;
      if (isAuthenticated(session)) {
        throw new Error('ZBUGS_LOGOUT_AUTHORITY_RETAINED: logout retained an authenticated authority');
      }
      this.#publish({phase: 'anonymous', session, current: null, error: null});
    } catch (error) {
      this.#publishError(generation, error);
    } finally {
      this.#finishFlow(generation);
    }
  }

  async switchBearer(token: string | null): Promise<void> {
    const generation = this.#beginFlow('transitioning');
    try {
      await this.#client.replaceBearerToken(token);
      if (generation !== this.#generation) return;
      await this.#refreshGeneration(generation);
    } catch (error) {
      this.#publishError(generation, error);
    } finally {
      this.#finishFlow(generation);
    }
  }
}

const controllersByClient = new WeakMap<SessionClient, SessionController>();

/** Remount-stable controller ownership for one module-level Snapback client. */
export function getSessionController(options: SessionControllerOptions): SessionController {
  const existing = controllersByClient.get(options.client);
  if (existing) return existing;
  const controller = new SessionController(options);
  controllersByClient.set(options.client, controller);
  return controller;
}

const SessionContext = createContext<SessionController | null>(null);

export function SessionProvider(props: Readonly<{
  controller: SessionController;
  children: ReactNode;
}>): ReactNode {
  const connection = useSnapbackConnection();
  useEffect(() => props.controller.setConnection(connection.status), [
    props.controller,
    connection.status,
  ]);
  useEffect(() => {
    void props.controller.bootstrap();
  }, [props.controller]);
  return <SessionContext.Provider value={props.controller}>{props.children}</SessionContext.Provider>;
}

export function useSession(): Readonly<{
  snapshot: SessionSnapshot;
  login(redirect?: string): string;
  logout(): Promise<void>;
  switchBearer(token: string | null): Promise<void>;
  refresh(): Promise<void>;
}> {
  const controller = useContext(SessionContext);
  if (!controller) throw new Error('useSession requires SessionProvider');
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return useMemo(() => Object.freeze({
    snapshot,
    login: (redirect?: string) => controller.login(redirect),
    logout: () => controller.logout(),
    switchBearer: (token: string | null) => controller.switchBearer(token),
    refresh: () => controller.refresh(),
  }), [controller, snapshot]);
}

export function useIsOffline(): boolean {
  const {snapshot} = useSession();
  return snapshot.offline === 'offline';
}
