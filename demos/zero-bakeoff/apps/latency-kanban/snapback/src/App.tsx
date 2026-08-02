import { useSnapbackConnection, useSnapbackMutation, useSnapbackQuery } from '@expo/snapback-react';
import api from '../generated/api.mjs';

export function App() {
  const board = useSnapbackQuery(api.boardCards, {});
  const move = useSnapbackMutation(api.moveCard, {
    optimistic: {
      query: api.boardCards,
      args: {},
      update(cards, args) {
        return cards.map((card) => card._id === args.id
          ? { ...card, columnKey: args.columnKey, rank: args.rank, revision: card.revision + 1 }
          : card);
      },
      isAuthoritative(cards, result) {
        return cards.some((card) => card._id === result._id && card.revision === result.revision);
      },
    },
  });
  const connection = useSnapbackConnection();
  const cards = board.status === 'ready' || board.status === 'refreshing' ? board.data : [];
  return <main data-testid="lk-board">
    <output data-testid="lk-status">{connection.status}:{board.status}</output>
    <output data-testid="lk-error">{board.status === 'error' ? board.error.code : ''}</output>
    {cards.map((card) => <article key={card._id} data-testid={`lk-card-${card.key}`}>
      <span>{card.title}</span>
      <button data-testid={`lk-move-${card.key}`} onClick={() => void move({
        id: card._id,
        columnKey: card.columnKey === 'c3' ? 'c0' : `c${Number(card.columnKey.slice(1)) + 1}`,
        rank: card.rank,
        expectedRevision: card.revision,
      })}>Move</button>
    </article>)}
  </main>;
}
