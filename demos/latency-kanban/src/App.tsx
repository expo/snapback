import { useEffect, useRef, useState } from 'react';
import type {
  FunctionArgs,
  FunctionResult,
  OptimisticMutationView,
  SnapbackClient,
  SnapbackFunctionReference,
} from '@expo/snapback-client';
import api from '../snapback/generated/api';

type Cards = FunctionResult<typeof api.boardCards>;
type Boards = FunctionResult<typeof api.boardList>;
type MutationReference = SnapbackFunctionReference<string, 'Mutation', Record<string, unknown>, unknown>;
const COLUMNS = ['backlog', 'ready', 'doing', 'done'] as const;

export function App({ client }: { client: SnapbackClient }) {
  const [cards, setCards] = useState<Cards>([]);
  const [boards, setBoards] = useState<Boards>([]);
  const [title, setTitle] = useState('Paint before the round trip');
  const [status, setStatus] = useState('Hydrating retained base…');
  const viewRef = useRef<OptimisticMutationView | null>(null);
  const baseRef = useRef<{ cards: Cards; boards: Boards }>({ cards: [], boards: [] });
  const pendingPaint = useRef<{ name: string; start: number } | null>(null);

  const publishView = () => {
    const view = viewRef.current;
    if (!view) return;
    const visible = view.getSnapshot().visibleRows;
    setCards((visible.cards ?? []) as Cards);
    setBoards((visible.boards ?? []) as Boards);
    if (pendingPaint.current) {
      const paint = pendingPaint.current;
      pendingPaint.current = null;
      setStatus(`${paint.name} painted from generated IR in ${(performance.now() - paint.start).toFixed(1)} ms`);
    }
  };

  useEffect(() => {
    let disposed = false;
    let stopView = () => {};
    const handles: Array<{ dispose(): void | Promise<void> }> = [];
    void (async () => {
      // Boot replay is deliberately first: a retained outbox paints before
      // starting auth/session or live-query network work. P2 retained/live
      // deliveries then replace this provisional empty base through M3.
      const view = await client.createOptimisticMutationView({
        authoritativeRows: baseRef.current,
        connected: false,
      });
      if (disposed) {
        view.close();
        return;
      }
      viewRef.current = view;
      stopView = view.subscribe(publishView);
      publishView();
      const bootReplayed = view.getSnapshot().layers.length > 0;
      setStatus(bootReplayed
        ? 'Boot replay restored pending intent before network settlement.'
        : 'Loading retained board state…');

      const rebaseFromDelivery = (cause: string) => {
        void view.rebase({
          authoritativeRows: baseRef.current,
          connected: true,
          cause,
        });
      };
      const [boardHandle, cardHandle] = await Promise.all([
        client.liveQuery(api.boardList, {
          connectionId: 'latency-kanban-boards',
          persistResume: true,
          onUpdate: (rows) => {
            baseRef.current = { ...baseRef.current, boards: rows };
            rebaseFromDelivery('boards-retained-or-live-delivery');
          },
        }),
        client.liveQuery(api.boardCards, {
          connectionId: 'latency-kanban-cards',
          persistResume: true,
          onUpdate: (rows) => {
            baseRef.current = { ...baseRef.current, cards: rows };
            rebaseFromDelivery('cards-retained-or-live-delivery');
          },
        }),
      ]);
      if (disposed) {
        await Promise.all([boardHandle.dispose(), cardHandle.dispose()]);
        return;
      }
      handles.push(boardHandle, cardHandle);
      baseRef.current = { boards: boardHandle.rows, cards: cardHandle.rows };
      await view.rebase({
        authoritativeRows: baseRef.current,
        connected: true,
        cause: 'live-query-handles-ready',
      });
      if (!bootReplayed) setStatus('Ready — mutations paint from generated IR.');
    })().catch((error) => setStatus(String(error?.message ?? error)));
    return () => {
      disposed = true;
      stopView();
      viewRef.current?.close();
      viewRef.current = null;
      for (const handle of handles) void handle.dispose();
    };
  }, [client]);

  const settle = async (clientMutationId: string) => {
    const [boardResult, cardResult] = await Promise.all([
      client.query(api.boardList), client.query(api.boardCards),
    ]);
    baseRef.current = { boards: boardResult.rows, cards: cardResult.rows };
    await viewRef.current?.rebase({
      authoritativeRows: baseRef.current,
      retiredSettlementIdentities: [clientMutationId],
      connected: true,
    });
  };

  const run = async <Reference extends MutationReference>(
    name: string,
    reference: Reference,
    args: FunctionArgs<Reference>,
  ) => {
    pendingPaint.current = { name, start: performance.now() };
    try {
      const result = await client.mutate(reference, { args });
      if (result.clientMutationId) await settle(result.clientMutationId);
      setStatus(`${name} settled; authoritative delivery retired ${result.clientMutationId}.`);
    } catch (error) {
      setStatus(`${name} refused: ${String((error as Error).message)}`);
    }
  };

  const board = boards[0];
  const nextRank = Math.max(0, ...cards.map((card) => card.rank)) + 100;

  return <main>
    <header><div><p className="eyebrow">Move-3 Phase-1 exit</p><h1>Latency Kanban</h1></div><p>{status}</p></header>
    <section className="toolbar">
      {!board && <button onClick={() => void run('create board', api.createBoard, { name: 'Latency board' })}>Create board</button>}
      <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Card title" />
      <button disabled={!board} onClick={() => board && void run('create', api.createCard, {
        boardId: board._id, title, column: 'backlog', rank: nextRank, assignee: 'Unassigned', locked: false,
      })}>Create card</button>
    </section>
    <section className="board">
      {COLUMNS.map((column, columnIndex) => <article key={column}>
        <h2>{column}</h2>
        {cards.filter((card) => !card.archived && card.column === column).map((card) => <div className="card" key={card._id}>
          <strong>{card.title}</strong><small>{card.assignee} · r{card.revision}</small>
          <div className="actions">
            <button onClick={() => void run('edit', api.editCard, { cardId: card._id, title: `${card.title}!` })}>Edit</button>
            <button onClick={() => void run('assign', api.assignCard, { cardId: card._id, assignee: 'Ada' })}>Assign</button>
            <button onClick={() => void run('reorder', api.reorderCard, {
              cardId: card._id, column: COLUMNS[(columnIndex + 1) % COLUMNS.length], rank: card.rank + 1,
            })}>Move</button>
            <button onClick={() => void run('archive', api.archiveCard, { cardId: card._id })}>Archive</button>
          </div>
        </div>)}
      </article>)}
    </section>
  </main>;
}
