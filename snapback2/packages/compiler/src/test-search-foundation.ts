import assert from 'node:assert/strict';
import { SEARCH_CONTRACT, prepareIndexAtom, indexKeysEqual, type IndexComponent, type IndexKeyExpr, type IndexAtom } from '../../evaluator/src/search-key';
import { SearchInputError } from '../../evaluator/src/unicode';
import type { Expr } from './ir';

export function registerSearchFoundationChecks(test: (name: string, run: () => void) => void) {
  test('preparatory search contracts preserve explicit components and independent operation Q', () => {
    const component: IndexComponent = { WordPrefixes: { fields: ['name', 'handle'], contract: SEARCH_CONTRACT } };
    const expr: IndexKeyExpr<Expr> = { WordPrefix: { source: { Variable: 'term' }, contract: SEARCH_CONTRACT, source_max: 2000 } };
    assert.deepEqual(JSON.parse(JSON.stringify(expr)), { WordPrefix: { source: { Variable: 'term' }, contract: 'u17-nfc-scf-nfc-wsp-p', source_max: 2000 } });
    const atom = (source: string): IndexAtom => ({ WordPrefix: { contract: SEARCH_CONTRACT, source } });
    const shortFieldKey = prepareIndexAtom(component, atom('É'), 1);
    const independentQueryKey = prepareIndexAtom(component, atom('E\u0301'), expr.WordPrefix.source_max);
    assert(indexKeysEqual([shortFieldKey], [independentQueryKey]));
    assert.throws(() => prepareIndexAtom(component, atom('É E\u0301'), 2000), SearchInputError);
    assert.throws(() => prepareIndexAtom(component, { WordPrefix: { contract: SEARCH_CONTRACT, source: 'x', source_max: 9999 } }, 1), SearchInputError);
  });
}
