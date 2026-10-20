// Reference implementation of examples/quote-total.plog (PlainLogic 0.1).
//
// Mapping notes:
// - record -> interface; record construction -> object literal.
// - Int -> number; identifiers and fields use camelCase.
// - `//` floor division -> Math.floor(a / b); the accumulation loop ->
//   reduce(...) is the faithful TypeScript idiom.

export interface Line {
  priceCents: number;
  quantity: number;
}

export interface Quote {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export function quote(lines: Line[]): Quote {
  const subtotal = lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
  const discount = subtotal >= 10000 ? Math.floor((subtotal * 10) / 100) : 0;
  return { subtotalCents: subtotal, discountCents: discount, totalCents: subtotal - discount };
}
