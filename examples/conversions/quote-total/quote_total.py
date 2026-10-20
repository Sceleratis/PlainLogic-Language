"""Reference implementation of examples/quote-total.plog (PlainLogic 0.1).

Mapping notes:
- record -> @dataclass(frozen=True); case equality relies on value equality.
- Int -> int; List[Line] -> list[Line].
- The accumulation loop -> sum(...) is the faithful Python idiom.
- `//` floor division -> Python `//` (identical semantics).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Line:
    price_cents: int
    quantity: int


@dataclass(frozen=True)
class Quote:
    subtotal_cents: int
    discount_cents: int
    total_cents: int


def quote(lines: list[Line]) -> Quote:
    subtotal = sum(line.price_cents * line.quantity for line in lines)
    discount = subtotal * 10 // 100 if subtotal >= 10000 else 0
    return Quote(subtotal_cents=subtotal, discount_cents=discount,
                 total_cents=subtotal - discount)
