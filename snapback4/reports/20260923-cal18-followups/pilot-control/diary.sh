record() {
  {
    printf '\n$'
    printf ' %q' "$@"
    printf '\n'
    "$@"
    rc=$?
    printf '[exit_code: %s]\n' "$rc"
    return "$rc"
  } 2>&1 | tee -a command-output-diary.txt
  return "${PIPESTATUS[0]}"
}
