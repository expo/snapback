import { describe, expect, it } from 'bun:test';
import { compileContractModule } from '@exact/contract/vite-plugin';

describe('All Aboard helper result types (ENG-25268)', () => {
  it('rejects diary 0010 headsgn at the helper-result member', () => {
    const source = `use boardTrains from "./data.ts"
component HeadsgnRegression
  derive board = boardTrains("sf", "south", 0, 0, [], [], [])
  view
    text board.hero.headsgn
`;
    try {
      compileContractModule(source, new URL('./headsgn-regression.contract', import.meta.url).pathname);
      throw new Error('expected headsgn to fail Contract compilation');
    } catch (error) {
      const diagnostic = (error as { diagnostics?: Array<Record<string, unknown>> }).diagnostics?.[0];
      expect(diagnostic).toMatchObject({
        code: 'shape_unknown_member',
        line: 5,
        message: expect.stringContaining('did you mean "headsign"?'),
      });
    }
  });
});
