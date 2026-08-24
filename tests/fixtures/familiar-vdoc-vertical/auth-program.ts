import { defineAuth } from "./generated/server";

export const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: "password",
      identifier: "email",
      provider: "builtIn",
      recovery: "recoveryCodes",
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: "no-independent-recovery",
      rotateAfterUse: true,
      plaintextCustody: "one-time-response",
    },
    lastAuthenticator: "enforce",
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});
