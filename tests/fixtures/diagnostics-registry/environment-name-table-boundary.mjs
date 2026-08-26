const SNAPBACK_ENVIRONMENT_NAMES = ['SNAPBACK_FOO_ENV']; throw new Error('SNAPBACK_REAL_FAILURE');

const SNAPBACK_COMMENT_ENVIRONMENT_NAMES = [
  // { legacy name
  'SNAPBACK_COMMENT_BRACE_ENV',
];

const SNAPBACK_STRING_ENVIRONMENT_NAMES = [
  '{ legacy name',
  'SNAPBACK_STRING_BRACE_ENV',
];

const bracePattern = /\{/u;
const SNAPBACK_REGEX_ENVIRONMENT_NAMES = ['SNAPBACK_REGEX_BRACE_ENV'];

const SNAPBACK_NESTED_ENVIRONMENT_NAMES = {
  metadata: 'legacy',
  current: 'SNAPBACK_AFTER_NESTED_VALUE_ENV',
};

const SNAPBACK_KEYED_ENVIRONMENT_NAMES = {
  'SNAPBACK_STRING_KEY_ENV': true,
};

const fixtureOptions = {
  environment: {
    SNAPBACK_OBJECT_BEFORE_STRING_BRACE: '}',
    SNAPBACK_OBJECT_AFTER_STRING_BRACE: 'value',
  },
};

const environment = {
  refresh() {
    throw codedError('SNAPBACK_APP_BINDING_EXPIRED');
  },
};
bindingFailure('SNAPBACK_APP_BINDING_EXPIRED');
