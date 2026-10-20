// Reference implementation of examples/quote-total.plog (PlainLogic 0.1).
//
// Mapping notes:
// - record -> C# record, whose value equality is what the cases assert.
// - Int -> int (choose long when cent totals can exceed ~2.1 billion).
// - `subtotal * 10 // 100`: floor division. The scope guarantees
//   nonnegative values, so C# integer `/` (truncating) agrees with floor
//   division here; with negative values it would not.

using System.Collections.Generic;
using System.Linq;

public sealed record Line(int PriceCents, int Quantity);

public sealed record Quote(int SubtotalCents, int DiscountCents, int TotalCents);

public static class QuoteTotal
{
    public static Quote Quote(IReadOnlyList<Line> lines)
    {
        var subtotal = lines.Sum(line => line.PriceCents * line.Quantity);
        var discount = subtotal >= 10000 ? subtotal * 10 / 100 : 0;
        return new Quote(subtotal, discount, subtotal - discount);
    }
}
