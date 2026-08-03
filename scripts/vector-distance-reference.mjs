// Independent exact-arithmetic oracle for LLP 0132's committed binary64
// profile. This module deliberately does not import or call a Snapback kernel.
// Every primitive is derived with BigInt dyadic/rational arithmetic and then
// rounded to IEEE-754 binary64, round-to-nearest-ties-even.

import { createHash } from 'node:crypto';

const SIGN = 1n << 63n;
const FRACTION_MASK = (1n << 52n) - 1n;
const EXPONENT_MASK = 0x7ffn;
const MIN_NORMAL_EXPONENT = -1022;
const MIN_SUBNORMAL_EXPONENT = -1074;

function bitLength(value) {
  return value === 0n ? 0 : value.toString(2).length;
}

function roundRatioToEven(numerator, denominator) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * 2n;
  return doubled > denominator || (doubled === denominator && (quotient & 1n) === 1n)
    ? quotient + 1n
    : quotient;
}

function roundShiftToEven(value, shift) {
  if (shift <= 0) return value << BigInt(-shift);
  return roundRatioToEven(value, 1n << BigInt(shift));
}

export function bitsToDyadic(bitsText) {
  const bits = BigInt(`0x${bitsText}`);
  const negative = (bits & SIGN) !== 0n;
  const exponent = Number((bits >> 52n) & EXPONENT_MASK);
  const fraction = bits & FRACTION_MASK;
  if (exponent === 0x7ff) throw new TypeError('oracle accepts finite binary64 only');
  if (exponent === 0 && fraction === 0n) return { coefficient: 0n, exponent: 0 };
  const coefficient = exponent === 0 ? fraction : (1n << 52n) | fraction;
  return {
    coefficient: negative ? -coefficient : coefficient,
    exponent: exponent === 0 ? MIN_SUBNORMAL_EXPONENT : exponent - 1023 - 52,
  };
}

function addDyadic(left, right) {
  if (left.coefficient === 0n) return right;
  if (right.coefficient === 0n) return left;
  const exponent = Math.min(left.exponent, right.exponent);
  return {
    coefficient:
      (left.coefficient << BigInt(left.exponent - exponent))
      + (right.coefficient << BigInt(right.exponent - exponent)),
    exponent,
  };
}

function negateDyadic(value) {
  return { coefficient: -value.coefficient, exponent: value.exponent };
}

function multiplyDyadic(left, right) {
  return {
    coefficient: left.coefficient * right.coefficient,
    exponent: left.exponent + right.exponent,
  };
}

export function roundDyadicToBits(value) {
  if (value.coefficient === 0n) return '0000000000000000';
  const negative = value.coefficient < 0n;
  const coefficient = negative ? -value.coefficient : value.coefficient;
  const floorExponent = bitLength(coefficient) - 1 + value.exponent;
  let bits;
  if (floorExponent >= MIN_NORMAL_EXPONENT) {
    let unbiased = floorExponent;
    const shift = bitLength(coefficient) - 53;
    let significand = roundShiftToEven(coefficient, shift);
    if (significand === 1n << 53n) {
      significand >>= 1n;
      unbiased += 1;
    }
    if (unbiased > 1023) throw new RangeError('oracle result overflowed binary64');
    const exponentBits = BigInt(unbiased + 1023);
    bits = (exponentBits << 52n) | (significand - (1n << 52n));
  } else {
    const unitsShift = value.exponent - MIN_SUBNORMAL_EXPONENT;
    const significand = roundShiftToEven(coefficient, -unitsShift);
    if (significand === 0n) return '0000000000000000';
    bits = significand >= 1n << 52n
      ? 1n << 52n
      : significand;
  }
  if (negative) bits |= SIGN;
  return bits.toString(16).padStart(16, '0');
}

function roundedDyadic(value) {
  return bitsToDyadic(roundDyadicToBits(value));
}

function parseDecimalRational(text) {
  const match = /^(-?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new TypeError(`invalid decimal witness ${text}`);
  const [, sign, integer, fraction = '', exponentText = '0'] = match;
  let numerator = BigInt(`${integer}${fraction}` || '0');
  let denominator = 1n;
  const decimalExponent = Number(exponentText) - fraction.length;
  if (decimalExponent >= 0) numerator *= 10n ** BigInt(decimalExponent);
  else denominator = 10n ** BigInt(-decimalExponent);
  if (sign === '-') numerator = -numerator;
  return { numerator, denominator };
}

/// Round a JSON decimal to `digits` significant decimal digits with decimal
/// round-to-nearest-ties-even. This models IEEE 754 §5.12.2's permitted
/// finite-H preprocessing independently of the binary64 converter.
export function roundDecimalToSignificantDigits(text, digits) {
  if (!Number.isSafeInteger(digits) || digits < 1) throw new TypeError('digits must be positive');
  const match = /^(-?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new TypeError(`invalid decimal witness ${text}`);
  const [, sign, integer, fraction = '', exponentText = '0'] = match;
  const combined = `${integer}${fraction}`.replace(/^0+/, '');
  if (combined === '') return sign === '-' ? '-0' : '0';
  const decimalPower = Number(exponentText) - fraction.length;
  if (combined.length <= digits) return `${sign}${combined}e${decimalPower}`;
  const removed = combined.length - digits;
  const divisor = 10n ** BigInt(removed);
  const rounded = roundRatioToEven(BigInt(combined), divisor);
  return `${sign}${rounded}e${decimalPower + removed}`;
}

function compareRatioToPowerOfTwo(numerator, denominator, exponent) {
  if (exponent >= 0) return numerator - (denominator << BigInt(exponent));
  return (numerator << BigInt(-exponent)) - denominator;
}

export function decimalToBits(text) {
  const rational = parseDecimalRational(text);
  if (rational.numerator === 0n) {
    return text.startsWith('-') ? '8000000000000000' : '0000000000000000';
  }
  const negative = rational.numerator < 0n;
  const numerator = negative ? -rational.numerator : rational.numerator;
  const { denominator } = rational;
  let floorExponent = bitLength(numerator) - bitLength(denominator);
  while (compareRatioToPowerOfTwo(numerator, denominator, floorExponent) < 0n) floorExponent -= 1;
  while (compareRatioToPowerOfTwo(numerator, denominator, floorExponent + 1) >= 0n) floorExponent += 1;

  let bits;
  if (floorExponent >= MIN_NORMAL_EXPONENT) {
    let unbiased = floorExponent;
    const scale = 52 - unbiased;
    let significand = scale >= 0
      ? roundRatioToEven(numerator << BigInt(scale), denominator)
      : roundRatioToEven(numerator, denominator << BigInt(-scale));
    if (significand === 1n << 53n) {
      significand >>= 1n;
      unbiased += 1;
    }
    if (unbiased > 1023) throw new RangeError('decimal witness overflowed binary64');
    bits = (BigInt(unbiased + 1023) << 52n) | (significand - (1n << 52n));
  } else {
    const significand = roundRatioToEven(numerator << 1074n, denominator);
    if (significand === 0n) return '0000000000000000';
    bits = significand >= 1n << 52n ? 1n << 52n : significand;
  }
  if (negative) bits |= SIGN;
  return bits.toString(16).padStart(16, '0');
}

function strictTerms(metric, queryBits, candidateBits) {
  return queryBits.map((query, index) => {
    const left = bitsToDyadic(query);
    const right = bitsToDyadic(candidateBits[index]);
    if (metric === 'dot') return roundedDyadic(multiplyDyadic(left, right));
    if (metric === 'l2sq') {
      const difference = roundedDyadic(addDyadic(left, negateDyadic(right)));
      return roundedDyadic(multiplyDyadic(difference, difference));
    }
    throw new TypeError(`unknown metric ${metric}`);
  });
}

function accumulateStrict(terms) {
  let accumulator = { coefficient: 0n, exponent: 0 };
  for (const term of terms) accumulator = roundedDyadic(addDyadic(accumulator, term));
  return roundDyadicToBits(accumulator);
}

export function strictDistanceBits(metric, queryBits, candidateBits) {
  if (queryBits.length !== candidateBits.length) throw new TypeError('dimension mismatch');
  return accumulateStrict(strictTerms(metric, queryBits, candidateBits));
}

function fmaDistanceBits(metric, queryBits, candidateBits) {
  let accumulator = { coefficient: 0n, exponent: 0 };
  for (let index = 0; index < queryBits.length; index += 1) {
    const left = bitsToDyadic(queryBits[index]);
    const right = bitsToDyadic(candidateBits[index]);
    const product = metric === 'dot'
      ? multiplyDyadic(left, right)
      : (() => {
          const difference = roundedDyadic(addDyadic(left, negateDyadic(right)));
          return multiplyDyadic(difference, difference);
        })();
    accumulator = roundedDyadic(addDyadic(accumulator, product));
  }
  return roundDyadicToBits(accumulator);
}

function reverseDistanceBits(metric, queryBits, candidateBits) {
  return accumulateStrict(strictTerms(metric, queryBits, candidateBits).reverse());
}

function extendedDistanceBits(metric, queryBits, candidateBits) {
  let accumulator = { coefficient: 0n, exponent: 0 };
  for (const term of strictTerms(metric, queryBits, candidateBits)) {
    accumulator = addDyadic(accumulator, term);
  }
  return roundDyadicToBits(accumulator);
}

function isSubnormal(bits) {
  return (BigInt(`0x${bits}`) & (EXPONENT_MASK << 52n)) === 0n
    && (BigInt(`0x${bits}`) & FRACTION_MASK) !== 0n;
}

function flushBits(bits) {
  if (!isSubnormal(bits)) return bits;
  return (BigInt(`0x${bits}`) & SIGN) === 0n ? '0000000000000000' : '8000000000000000';
}

function ftzDistanceBits(metric, queryBits, candidateBits) {
  const flushedQuery = queryBits.map(flushBits);
  const flushedCandidate = candidateBits.map(flushBits);
  let accumulator = '0000000000000000';
  for (let index = 0; index < flushedQuery.length; index += 1) {
    const left = bitsToDyadic(flushedQuery[index]);
    const right = bitsToDyadic(flushedCandidate[index]);
    let term;
    if (metric === 'dot') term = roundDyadicToBits(multiplyDyadic(left, right));
    else {
      const difference = flushBits(roundDyadicToBits(addDyadic(left, negateDyadic(right))));
      term = roundDyadicToBits(multiplyDyadic(bitsToDyadic(difference), bitsToDyadic(difference)));
    }
    term = flushBits(term);
    accumulator = flushBits(roundDyadicToBits(addDyadic(bitsToDyadic(accumulator), bitsToDyadic(term))));
  }
  return accumulator === '8000000000000000' ? '0000000000000000' : accumulator;
}

export function forbiddenAlternativeBits(witness) {
  const { metric, queryBits, candidateBits, forbiddenAlternative } = witness;
  switch (forbiddenAlternative) {
    case 'fused-term-accumulation':
      return fmaDistanceBits(metric, queryBits, candidateBits);
    case 'reverse-reduction-order':
      return reverseDistanceBits(metric, queryBits, candidateBits);
    case 'single-round-extended-accumulation':
      return extendedDistanceBits(metric, queryBits, candidateBits);
    case 'flush-subnormals-to-zero':
      return ftzDistanceBits(metric, queryBits, candidateBits);
    case 'round-decimal-to-finite-h': {
      const finiteH = witness.wireInputs.finiteHDigits;
      if (!Number.isSafeInteger(finiteH)) throw new TypeError('finite-H witness is missing H');
      const query = witness.wireInputs.queryDecimals
        .map((decimal) => decimalToBits(roundDecimalToSignificantDigits(decimal, finiteH)));
      const candidate = witness.wireInputs.candidateDecimals
        .map((decimal) => decimalToBits(roundDecimalToSignificantDigits(decimal, finiteH)));
      return strictDistanceBits(metric, query, candidate);
    }
    default:
      throw new TypeError(`unknown forbidden alternative ${forbiddenAlternative}`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function profileDigest(profile) {
  return `sha256:${createHash('sha256').update(canonicalJson(profile)).digest('hex')}`;
}
