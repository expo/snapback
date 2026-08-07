import {useZerobugsQuery} from '../data/queries.ts';

export function QueryUsers() {
  const result = useZerobugsQuery('allUsers', {limit: 200, start: null});
  if (result.status === 'pending' || result.status === 'refreshing') return <div>Loading...</div>;
  if (result.status === 'refused') return <div>Error: {result.refusal.message}</div>;
  return (
    <div data-debug-completeness={result.status}>
      Query Users Component
      <ul>{result.value?.items.map(user => <li key={user.id}>{user.name} ({user.login})</li>)}</ul>
    </div>
  );
}
