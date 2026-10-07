// @ref LLP 3000.033#1.3 — recognize padding exactly as Rust split_ascii_whitespace
// in auth::parse_bearer does (HT, LF, FF, CR, space; not JS trim's Unicode set).
// This is a prefix check, not authority. Keep the supplied credential unchanged.
export const isReadToken = (token?: string): boolean => /^[\t\n\f\r ]*ro\./.test(token ?? "");
