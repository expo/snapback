import { isDeepStrictEqual } from "node:util";

function ownField(object, key) {
  return object !== null
    && typeof object === "object"
    && Object.hasOwn(object, key)
    ? { present: true, value: object[key] }
    : { present: false };
}

// @ref LLP 0201#d2--quantitative-instrument — a retained record may use its
// historical validator only when the submitted and hash-bound base records
// carry the complete identity of the same physical instrument campaign.
export function extractCampaignIdentity(record) {
  const extension = record?.socialMessenger;
  return {
    harnessInstrument: ownField(record?.harness?.environment, "instrument"),
    instrumentVersion: ownField(extension, "instrumentVersion"),
    orientationInstrument: ownField(extension?.orientation, "instrument"),
    setup: ownField(extension, "setup"),
  };
}

export function campaignIdentitiesEqual(left, right) {
  return isDeepStrictEqual(left, right);
}

export function campaignIdentityBoundToFreeze(record, {
  pin,
  versions,
  manifestPath,
  manifestSha256,
}) {
  if (
    versions === null
    || typeof versions !== "object"
    || Array.isArray(versions)
    || !["schema", "ui", "choreography"].every(
      (field) => typeof versions[field] === "string" && versions[field].length > 0,
    )
    || Object.keys(versions).length !== 3
  ) return null;
  const identity = extractCampaignIdentity(record);
  const setup = identity.setup;
  const expected = {
    harnessInstrument: { present: true, value: pin },
    instrumentVersion: { present: true, value: pin },
    orientationInstrument: {
      present: true,
      value: {
        pin,
        manifest: { path: manifestPath, sha256: manifestSha256 },
        versions,
      },
    },
    setup,
  };
  if (!campaignIdentitiesEqual(identity, expected)) return null;
  if (
    setup.present
    && (
      setup.value === null
      || typeof setup.value !== "object"
      || Array.isArray(setup.value)
      || setup.value.schemaVersion !== "social-messenger.setup-identity.v1"
      || setup.value.instrumentPin !== pin
    )
  ) return null;
  return identity;
}
