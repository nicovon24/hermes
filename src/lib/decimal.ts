export type DecimalString = string | { toString(): string };

export function decimalToScaledInteger(value: DecimalString, scale: number) {
  const source = value.toString().trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(source);
  if (!match) throw new Error(`Invalid decimal value: ${source}`);
  const [, sign, whole, suppliedFraction = ""] = match;
  const discarded = suppliedFraction.slice(scale);
  if (discarded && !/^0+$/.test(discarded)) {
    throw new Error(`Decimal value has more than ${scale} significant fractional digits`);
  }
  const factor = 10n ** BigInt(scale);
  const fraction = suppliedFraction.slice(0, scale).padEnd(scale, "0");
  const result = BigInt(whole) * factor + BigInt(fraction || "0");
  return sign ? -result : result;
}

export function scaledIntegerToDecimal(value: bigint, scale: number) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const factor = 10n ** BigInt(scale);
  const whole = absolute / factor;
  if (scale === 0) return `${negative ? "-" : ""}${whole}`;
  return `${negative ? "-" : ""}${whole}.${String(absolute % factor).padStart(scale, "0")}`;
}

export function moneyToCents(value: DecimalString) {
  return decimalToScaledInteger(value, 2);
}

export function centsToMoney(value: bigint) {
  return scaledIntegerToDecimal(value, 2);
}

export function quantityToMicros(value: DecimalString) {
  return decimalToScaledInteger(value, 6);
}

export function roundDivide(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n || numerator < 0n) {
    throw new Error("roundDivide expects a non-negative numerator and positive denominator");
  }
  return (numerator + denominator / 2n) / denominator;
}

export function ceilDivide(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n || numerator < 0n) {
    throw new Error("ceilDivide expects a non-negative numerator and positive denominator");
  }
  return (numerator + denominator - 1n) / denominator;
}

export function formatArs(value: DecimalString) {
  const cents = moneyToCents(value);
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = (absolute / 100n).toLocaleString("es-AR");
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${negative ? "-" : ""}$ ${whole},${fraction}`;
}
