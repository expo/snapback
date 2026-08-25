import {
  __test,
  startBootstrapExchange,
} from '@expo/snapback-cli/expo-dev';

type BootstrapExchangeOptions = NonNullable<Parameters<typeof startBootstrapExchange>[1]>;
type SupervisorListenerOptions = Parameters<typeof __test.bindPlannedSupervisorListeners>[0];

const browserOrigins = ['http://127.0.0.1:8081'] as const;

const bootstrapExchangeOptions = {
  admittedAuthorityOrigins: () => browserOrigins,
  async onSharedAuth(request, response, url) {
    request.headers.origin satisfies string | readonly string[] | undefined;
    response.setHeader('x-snapback-fixture', 'shared-auth');
    url.searchParams satisfies URLSearchParams;
    return true;
  },
} satisfies Pick<
  BootstrapExchangeOptions,
  'admittedAuthorityOrigins' | 'onSharedAuth'
>;

const supervisorListenerOptions = {
  admittedAuthorityOrigins: browserOrigins,
  onSharedAuth: bootstrapExchangeOptions.onSharedAuth,
} satisfies Pick<
  SupervisorListenerOptions,
  'admittedAuthorityOrigins' | 'onSharedAuth'
>;

void bootstrapExchangeOptions;
void supervisorListenerOptions;
