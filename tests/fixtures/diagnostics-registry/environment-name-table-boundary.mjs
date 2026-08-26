const SNAPBACK_ENVIRONMENT_NAMES = ['SNAPBACK_FOO_ENV']; throw new Error('SNAPBACK_REAL_FAILURE');

const fixtureOptions = {
  environment: {
    SNAPBACK_OBJECT_BEFORE_STRING_BRACE: '}',
    SNAPBACK_OBJECT_AFTER_STRING_BRACE: 'value',
  },
};
