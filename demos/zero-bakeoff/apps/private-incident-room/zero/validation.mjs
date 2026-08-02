export const jsonValue = {'~standard': {version: 1, vendor: 'zero-bakeoff', validate(value) {
  return value && typeof value === 'object' ? {value} : {issues: [{message: 'object required'}]};
}}};
