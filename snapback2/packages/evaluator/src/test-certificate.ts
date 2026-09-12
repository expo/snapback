// Unit-only certificate fixtures for hand-built IR. Corpus tests retain Rust-issued certificates.
import { ClientStore as ProductionStore } from './store';
import { CURRENT_EVALUATOR, CURRENT_VALUE_MODEL_VERSION } from './runner';
import { canonicalProgramJson, canonicalSchemaJson } from './certificate-identity';
import { sha256 } from './hash';
import type { Context } from './types';
import type { SearchExecution } from './search-runtime';
export function fixtureCertificate(schema: any, program: any, budgets: any = {}): any {
  return { ...budgets, value_model_version: CURRENT_VALUE_MODEL_VERSION, evaluator_version: CURRENT_EVALUATOR,
    schema_hash: sha256(canonicalSchemaJson(schema)), plan_hash: sha256(canonicalProgramJson(program)) };
}
export class FixtureStore extends ProductionStore {
  override reexecute(program: any, context: Context, certificate?: any, search?: SearchExecution) {
    return super.reexecute(program, context, fixtureCertificate(this.schema, program, certificate ?? {}), search);
  }
  override applyMutation(program: any, context: Context, preview = false, certificate?: any, predictDelivery = false) {
    return super.applyMutation(program, context, preview, fixtureCertificate(this.schema, program, certificate ?? {}), predictDelivery);
  }
}

import { Twin as ProductionTwin } from '../../snapback2/src/twin';
/** Mock TwinSources bypass held-program admission; bind their deliberately hand-built operations. */
export class FixtureTwin extends ProductionTwin {
  constructor(sources: ConstructorParameters<typeof ProductionTwin>[0]) {
    super({ ...sources, program: () => {
      const program = sources.program();
      if (program) for (const operation of Object.values(program.programs)) {
        if (!Object.isFrozen(operation)) operation.certificate = fixtureCertificate(program.schema, operation.ir, operation.certificate);
      }
      return program;
    } });
  }
}
