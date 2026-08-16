// @ref LLP 0179#s2--command-member-and-wider-consumers — inspection consumes
// only the language-neutral descriptor document: it never imports a generated
// binding, React projection, or application handler module.

const copy = (value) => structuredClone(value);

const referenceSummary = (name, reference) => ({
  name,
  id: reference.id,
  kind: reference.kind ?? reference.artifactKind,
  sourceSpan: copy(reference.sourceSpan ?? null),
  requiredCapabilities: copy(reference.requiredCapabilities ?? []),
});

const commandRequiredCapabilities = (command) => [...new Set([
  ...(command.mutation.requiredCapabilities ?? []),
  ...(command.asset?.intent.requiredCapabilities ?? []),
  ...(command.intent?.requiredCapabilities ?? []),
])].sort();

const commandSummary = (name, command) => {
  const common = {
    name,
    kind: command.kind,
    mutation: referenceSummary(command.mutation.name, command.mutation),
  };
  if (command.kind === 'media-command.v1') {
    return {
      ...common,
      intent: referenceSummary(command.intent.name, command.intent),
      binding: copy(command.binding),
      passthroughArgs: copy(command.passthroughArgs),
      requiredCapabilities: commandRequiredCapabilities(command),
    };
  }
  return {
    ...common,
    asset: command.asset === null
      ? null
      : {
          input: command.asset.input,
          mutationArg: command.asset.mutationArg,
          optional: command.asset.optional,
          intent: referenceSummary(command.asset.intent.name, command.asset.intent),
        },
    passthroughArgs: copy(command.passthroughArgs),
    requiredCapabilities: commandRequiredCapabilities(command),
  };
};

export function enumerateAppDescriptorV1(descriptor) {
  const api = Object.fromEntries(
    ['queries', 'mutations', 'assets', 'ephemeral', 'queryGroups'].map((namespace) => [
      namespace,
      Object.entries(descriptor.api[namespace]).map(([name, reference]) => (
        referenceSummary(name, reference)
      )),
    ]),
  );
  const commands = Object.entries(descriptor.commands).map(([name, command]) => (
    commandSummary(name, command)
  ));
  const surfaces = Object.entries(descriptor.surfaces).map(([name, surface]) => {
    const members = Object.fromEntries(
      ['reads', 'mutations', 'commands', 'assets', 'presence'].map((namespace) => [
        namespace,
        Object.entries(surface[namespace]).map(([memberName, member]) => {
          const reference = namespace === 'commands'
            ? commandSummary(memberName, member.reference)
            : referenceSummary(member.reference.name ?? memberName, member.reference);
          return {
            name: memberName,
            reference,
            bindings: copy(member.bindings),
            inputs: copy(member.inputs),
            requiredCapabilities: copy(reference.requiredCapabilities),
          };
        }),
      ]),
    );
    return {
      name,
      id: surface.id,
      kind: surface.artifactKind,
      sourceSpan: copy(surface.sourceSpan),
      params: copy(surface.params),
      members,
    };
  });
  return {
    format: descriptor.format,
    identity: copy(descriptor.identity),
    ...(descriptor.authBootstrap === undefined
      ? {}
      : { authBootstrap: copy(descriptor.authBootstrap) }),
    capabilities: { required: copy(descriptor.capabilities.required) },
    api,
    commands,
    surfaces,
  };
}
