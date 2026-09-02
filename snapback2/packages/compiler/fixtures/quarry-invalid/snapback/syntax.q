query missingColon()
  return null

query missingType(value):
  return value

mutation malformed():
  return { value: }
