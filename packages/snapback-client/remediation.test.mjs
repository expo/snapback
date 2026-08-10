import assert from 'node:assert/strict';
import {
  createIdentifierRemediationSet,
  decodeRemediationSet,
} from './remediation.mjs';

const carrier = createIdentifierRemediationSet({
  artifactHash: 'sha256:0123456789abcdef',
  target: 'function',
  replacements: ['listTodos'],
});
const details = {
  remediationSet: {
    ...carrier,
    futureMember: true,
    items: [
      { ...carrier.items[0], futureItemMember: { okay: true } },
      { ...carrier.items[0], kind: 'futureKind' },
      { ...carrier.items[0], kind: 'toString' },
    ],
  },
};
const decoded = decodeRemediationSet(details);
assert.equal(decoded.items.length, 1);
assert.equal(decoded.items[0].action.replacement, 'listTodos');
assert.equal('futureMember' in decoded, false);

assert.throws(() => decodeRemediationSet({
  remediationSet: { ...carrier, schemaVersion: 'snapback.remediation-set.v2' },
}), /unsupported remediation schemaVersion/);
assert.throws(() => decodeRemediationSet({
  remediationSet: {
    ...carrier,
    artifactHash: 'sha256:aaaaaaaaaaaaaaaa',
  },
}), /not bound/);
assert.throws(() => decodeRemediationSet({
  remediationSet: {
    schemaVersion: 'snapback.remediation-set.v1',
    registryVersion: 'snapback.remediation-kinds.v1',
    items: [{
      kind: 'requestGrant',
      riskClass: 'authority-widening',
      machineApplicable: true,
      requiresApproval: false,
      authorityEffect: 'widens',
      precondition: { type: 'grantable-scope', grantableScope: 'function:query:listTodos' },
      action: { type: 'requestGrant', scope: 'function:query:listTodos' },
    }],
  },
}), /axes do not match/);

console.log('remediation.test.mjs: version, tolerance, registry-axis, and hash-binding cases passed');
