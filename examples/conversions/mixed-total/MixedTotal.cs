// Reference implementation of examples/mixed-total.plog (PlainLogic 0.2).
//
// Mapping notes:
// - The prose steps map to an accumulator loop; the one exact branch
//   (`if value > 0`) keeps its structure verbatim.
// - List[Int] -> IReadOnlyList<int>; Int -> int.

using System.Collections.Generic;

public static class MixedTotal
{
    public static int TotalPositive(IReadOnlyList<int> values)
    {
        var total = 0;
        foreach (var value in values)
        {
            if (value > 0)
            {
                total += value;
            }
        }
        return total;
    }
}
