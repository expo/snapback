// Hosted app-browser entry point. Its public constructor has no bearer,
// operator, or agent-credential seam; every session uses AuthCoordinator v3
// custody and sender-constrained transport.
//
// @ref LLP 0060#c1-the-v1-custody-claim — hosted admission requires structural
// exclusion of the generic direct-bearer constructor.
// @ref LLP 0077#browser-custody — the hosted artifact composes only the
// coordinator-owned non-extractable-key path.

import { SnapbackClient } from './index.mjs';

const HOSTED_OPTION_KEYS = new Set([
  'authCoordinator',
  'authClientProtocol',
  'authInvalidationProtocol',
  'authorityDescriptorProtocol',
  'authorizedLeaseProtocol',
  'clientStoreId',
  'authCounterCeiling',
]);

export class HostedBrowserSnapbackClient {
  constructor(baseUrl, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('HostedBrowserSnapbackClient options must be an object');
    }
    for (const key of Object.keys(options)) {
      if (!HOSTED_OPTION_KEYS.has(key)) {
        throw new TypeError(`HostedBrowserSnapbackClient option ${key} is not permitted`);
      }
    }
    if (!options.authCoordinator) {
      throw new TypeError('HostedBrowserSnapbackClient requires AuthCoordinator custody');
    }
    const internal = new SnapbackClient(baseUrl, {
      ...options,
      senderConstrained: true,
      adminToken: null,
      bearerToken: null,
      agentAuthority: null,
    });
    Object.freeze(this);
    return new Proxy(this, {
      get(target, property, receiver) {
        if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
        const value = Reflect.get(internal, property, internal);
        return typeof value === 'function' ? value.bind(internal) : value;
      },
      set() {
        throw new TypeError('HostedBrowserSnapbackClient transport posture is immutable');
      },
      defineProperty() {
        throw new TypeError('HostedBrowserSnapbackClient transport posture is immutable');
      },
      deleteProperty() {
        throw new TypeError('HostedBrowserSnapbackClient transport posture is immutable');
      },
      setPrototypeOf() {
        throw new TypeError('HostedBrowserSnapbackClient prototype is immutable');
      },
    });
  }

  get senderConstrained() {
    return true;
  }

  setBearerToken() {
    throw new TypeError('hosted browser custody cannot bypass sender-constrained transport');
  }
}
