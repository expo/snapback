// Private shared settlement-mapping proof. The outbox rewrite fence and the
// automatic optimistic-retirement matcher must accept exactly the same map.

const settlementMints = (record) => (Array.isArray(record?.settlementClaims?.mints)
  ? record.settlementClaims.mints
  : []);

const settlementMintIds = (record) => settlementMints(record)
  .map((mint) => mint?.claimed)
  .filter((claimed) => typeof claimed === 'string');

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const objectContract = (contract) => {
  if (contract?.kind === 'object') return contract;
  if (Array.isArray(contract?.fields)) {
    return { kind: 'object', fields: contract.fields, allowExtra: false };
  }
  return contract;
};

const contractField = (contractInput, name) => {
  const contract = objectContract(contractInput);
  if (contract?.kind === 'union') {
    const variants = (contract.variants ?? [])
      .map((variant) => contractField(variant, name))
      .filter((variant) => variant !== null);
    return variants.length === 0 ? null : { kind: 'union', variants };
  }
  if (contract?.kind !== 'object') return null;
  return contract.fields?.find((field) => field?.name === name)?.value ?? null;
};

const contractAtArgPath = (contract, path) => {
  if (typeof path !== 'string' || path.length === 0) return null;
  let node = objectContract(contract);
  for (const part of path.split('.')) {
    node = contractField(node, part);
    if (node === null) return null;
  }
  return node;
};

const contractAccepts = (contractInput, value) => {
  const contract = objectContract(contractInput);
  if (!plain(contract)) return false;
  if (contract.kind === 'union') {
    return (contract.variants ?? []).some((variant) => contractAccepts(variant, value));
  }
  if (contract.kind === 'literal') return Object.is(contract.value, value);
  if (contract.kind === 'null') return value === null;
  if (['string', 'principal', 'assetRef', 'mediaRef.v1', 'id'].includes(contract.kind)) {
    return typeof value === 'string';
  }
  if (contract.kind === 'boolean') return typeof value === 'boolean';
  if (['integer', 'finiteReal'].includes(contract.kind)) return typeof value === 'number';
  if (contract.kind === 'array' || contract.kind === 'tuple') return Array.isArray(value);
  if (contract.kind === 'object') return plain(value);
  return true;
};

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const rewriteContractIds = (value, contractInput, replacements) => {
  const contract = objectContract(contractInput);
  if (!plain(contract)) return value;
  if (contract.kind === 'id') {
    return typeof value === 'string' ? replacements.get(value) ?? value : value;
  }
  if (contract.kind === 'array' && Array.isArray(value)) {
    return value.map((item) => rewriteContractIds(item, contract.element, replacements));
  }
  if (contract.kind === 'tuple' && Array.isArray(value)) {
    return value.map((item, index) => rewriteContractIds(
      item,
      contract.elements?.[index],
      replacements,
    ));
  }
  if (contract.kind === 'object' && plain(value)) {
    const fields = new Map((contract.fields ?? []).map((field) => [field.name, field.value]));
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [
      name,
      fields.has(name) ? rewriteContractIds(item, fields.get(name), replacements) : item,
    ]));
  }
  if (contract.kind === 'union') {
    const candidates = (contract.variants ?? [])
      .filter((variant) => contractAccepts(variant, value))
      .map((variant) => rewriteContractIds(value, variant, replacements));
    if (candidates.length > 0 && candidates.every((candidate) => sameJson(candidate, candidates[0]))) {
      return candidates[0];
    }
  }
  return value;
};

const expressionContract = (expression, argsContract, bindings) => {
  if (expression === 'Args') return objectContract(argsContract);
  if (expression === 'RuntimeId') return { kind: 'id' };
  if (!plain(expression)) return null;
  if (typeof expression.Arg === 'string') {
    return contractAtArgPath(argsContract, expression.Arg);
  }
  if (typeof expression.Binding === 'string') {
    return bindings.get(expression.Binding) ?? null;
  }
  if (plain(expression.Field)) {
    const base = expression.Field.base
      ?? (typeof expression.Field.binding === 'string'
        ? { Binding: expression.Field.binding }
        : null);
    const key = expression.Field.key ?? expression.Field.field;
    return typeof key === 'string'
      ? contractField(expressionContract(base, argsContract, bindings), key)
      : null;
  }
  if (plain(expression.If)) {
    const variants = [expression.If.then, expression.If.else]
      .map((branch) => expressionContract(branch, argsContract, bindings))
      .filter((branch) => branch !== null);
    return variants.length === 0 ? null : { kind: 'union', variants };
  }
  if (plain(expression.Record?.fields)) {
    return {
      kind: 'object',
      allowExtra: false,
      fields: Object.entries(expression.Record.fields).map(([name, child]) => ({
        name,
        required: true,
        value: expressionContract(child, argsContract, bindings),
      })),
    };
  }
  return null;
};

const planWriteContracts = (operation, argsContract) => {
  const descriptors = [];
  const bindings = new Map();
  for (const [planStepIndex, step] of (operation?.plan?.steps ?? []).entries()) {
    if (!plain(step)) continue;
    if (plain(step.Get)) {
      bindings.set(step.Get.bind_as, {
        kind: 'object',
        allowExtra: true,
        fields: [{
          name: '_id', required: true, value: { kind: 'id', table: step.Get.table },
        }],
      });
      continue;
    }
    if (plain(step.Let)) {
      bindings.set(
        step.Let.bind_as,
        expressionContract(step.Let.expr, argsContract, bindings),
      );
      continue;
    }
    for (const [kind, operationName] of [
      ['Insert', 'insert'], ['Patch', 'patch'], ['Delete', 'delete'], ['InsertEach', 'insert'],
    ]) {
      const body = step[kind];
      if (!plain(body)) continue;
      if (kind === 'InsertEach' && typeof body.item_as === 'string') {
        const source = expressionContract(body.source, argsContract, bindings);
        bindings.set(body.item_as, source?.kind === 'array' ? source.element : null);
      }
      const values = Object.fromEntries(Object.entries(body.values ?? {}).map(([name, expr]) => [
        name,
        expressionContract(expr, argsContract, bindings),
      ]));
      descriptors.push({ planStepIndex, operation: operationName, table: body.table, values });
      if (kind === 'Insert' && typeof body.bind_id_as === 'string') {
        bindings.set(body.bind_id_as, { kind: 'id', table: body.table });
      }
      break;
    }
  }
  return descriptors;
};

export const rewriteGeneratedArgumentIdsV1 = (args, argsContract, replacements) => (
  replacements instanceof Map && replacements.size > 0
    ? rewriteContractIds(args, argsContract, replacements)
    : args
);

// Generated IR identifies structural write ids and connects each written value
// to its argument contract. Only leaves proven `kind: 'id'` are rewritten;
// equal ordinary strings remain application data.
export const rewriteOptimisticLayerIdsV1 = (
  layer,
  { operation, argsContract, replacements } = {},
) => {
  if (!plain(layer) || !(replacements instanceof Map) || replacements.size === 0) return layer;
  const descriptors = planWriteContracts(operation, argsContract);
  const descriptorsByPlanStep = new Map(descriptors.map((descriptor) => [
    descriptor.planStepIndex,
    descriptor,
  ]));
  return {
    ...layer,
    writes: (layer.writes ?? []).map((write) => {
      const candidate = Number.isSafeInteger(write?.planStepIndex)
        ? descriptorsByPlanStep.get(write.planStepIndex)
        : null;
      const descriptor = candidate?.operation === write?.operation
        && candidate?.table === write?.table
        ? candidate
        : null;
      const rewriteValues = (values) => {
        if (!plain(values)) return values;
        return Object.fromEntries(Object.entries(values).map(([name, value]) => {
          if (name === '_id') {
            return [name, typeof value === 'string' ? replacements.get(value) ?? value : value];
          }
          return [name, rewriteContractIds(value, descriptor?.values?.[name], replacements)];
        }));
      };
      return {
        ...write,
        ...(typeof write?.id === 'string'
          ? { id: replacements.get(write.id) ?? write.id }
          : {}),
        ...(write?.row === undefined
          ? {}
          : { row: rewriteValues(write.row) }),
        ...(write?.values === undefined
          ? {}
          : { values: rewriteValues(write.values) }),
      };
    }),
  };
};

// @ref LLP 0133#divergence-on-settle — leaf rewrite and presentation
// retirement are claim-ledger scoped; missing, duplicate, conflicting, or
// colliding map entries fail closed.
export const settlementIdResolution = (record, settlement) => {
  if (record?.settlementLane !== 're-derive') {
    return { replacements: new Map(), unresolved: new Set() };
  }
  const claimedMints = settlementMints(record);
  const claimed = settlementMintIds(record);
  const claimCounts = new Map();
  for (const id of claimed) claimCounts.set(id, (claimCounts.get(id) ?? 0) + 1);
  const claimById = new Map(claimedMints
    .filter((mint) => typeof mint?.claimed === 'string')
    .map((mint) => [mint.claimed, mint]));
  const entries = new Map();
  const receipt = settlement?.receipt?.kind === 'mutation'
    ? settlement.receipt
    : settlement?.kind === 'mutation' ? settlement : null;
  for (const entry of Array.isArray(receipt?.idMap) ? receipt.idMap : []) {
    if (!claimCounts.has(entry?.speculative)) continue;
    const candidates = entries.get(entry.speculative) ?? [];
    candidates.push(entry);
    entries.set(entry.speculative, candidates);
  }
  const replacements = new Map();
  const unresolved = new Set();
  const authoritativeOwners = new Map();
  for (const [speculative, count] of claimCounts) {
    const candidates = entries.get(speculative) ?? [];
    const entry = candidates.length === 1 ? candidates[0] : null;
    const claim = claimById.get(speculative);
    if (
      count !== 1
      || entry?.disposition !== 'mapped'
      || typeof entry?.authoritative !== 'string'
      || entry?.site !== claim?.site
      || entry?.occurrence !== claim?.occurrence
    ) {
      unresolved.add(speculative);
      continue;
    }
    const prior = authoritativeOwners.get(entry.authoritative);
    if (prior !== undefined && prior !== speculative) {
      unresolved.add(prior);
      unresolved.add(speculative);
      replacements.delete(prior);
      continue;
    }
    authoritativeOwners.set(entry.authoritative, speculative);
    replacements.set(speculative, entry.authoritative);
  }
  return { replacements, unresolved };
};
