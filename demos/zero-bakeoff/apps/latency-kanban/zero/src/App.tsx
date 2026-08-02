import { useQuery, useZero } from '@rocicorp/zero/react';
import { mutators } from '../mutators.ts';
import { queries } from '../queries.ts';

export function App() {
  const zero = useZero();
  const [cards, result] = useQuery(queries.board());
  return <main data-testid="lk-board">
    <output data-testid="lk-status">{result.type}</output>
    <output data-testid="lk-error" />
    {cards.map((card) => <article key={card.id} data-testid={`lk-card-${card.id}`}>
      <span>{card.title}</span>
      <button data-testid={`lk-move-${card.id}`} onClick={() => {
        const mutation = zero.mutate(mutators.card.move({
          id: card.id,
          columnID: card.columnID === 'c3' ? 'c0' : `c${Number(card.columnID.slice(1)) + 1}`,
          rank: card.rank,
          expectedRevision: card.revision,
        }));
        void mutation.server.catch(() => {});
      }}>Move</button>
    </article>)}
  </main>;
}
