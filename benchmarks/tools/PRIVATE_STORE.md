# Private benchmark evidence store

The private store is an operator-supplied directory outside the repository,
the public documentation tree, synchronized folders, and ordinary build logs.
The sanitizer creates this layout:

```text
<private-store>/                       mode 0700
  evidence/
    ev_<opaque-keyed-id>/              mode 0700
      original.json                    mode 0600
```

`original.json` is the complete canonical raw invocation, including tool
arguments and transcript fields. Public records use only the opaque directory
ID. They also carry an `hmac-sha256:` commitment computed with the separate
key named by `SNAPBACK_BENCHMARK_HMAC_KEY_FILE`. Neither the key, the private
store, nor raw inputs may live in Git. HMAC is required because plain hashes of
low-entropy arguments allow an observer to guess a value and confirm it.

Store access is an operational policy outside this repository. At minimum,
grant it only to benchmark operators and people with repository-disclosure
authority; preserve it for the published claim's audit lifetime; record any
authorized deletion in the private operational ledger. This repository does
not invent credentials, key contents, operator identities, or retention dates.

## Public redaction reason codes

| Code | Meaning |
|---|---|
| `PRIVATE_ORIGINAL` | The full canonical invocation is retained only in the private store. |
| `PRIVATE_TOOL_ARGUMENT` | Tool arguments were omitted from the public trace. |
| `PRIVATE_TRANSCRIPT` | Tool output/transcript material was omitted from the public trace. |
| `SECRET_PATTERN` | A retained metadata string matched a credential/token pattern and the matching span was replaced. |
| `PII_EMAIL` | An email address in retained metadata was replaced. |
| `PII_PHONE` | A phone-number-shaped value in retained metadata was replaced. |
| `PRIVATE_PATH` | A user/home/private/temp path in retained metadata was replaced. |
| `MACHINE_IDENTIFIER` | An IP address or UUID-shaped machine identifier in retained metadata was replaced. |

Redaction is allowed only when action class, usable tool name, timestamp,
result status, and opaque evidence pointer all survive. If a required field is
itself only sensitive material, the sanitizer returns
`BENCHMARK_PUBLISHER_UNSAFE_REDACTION_REQUIRED_FIELD`; the invocation cannot
enter a public claim without a safer source representation.
