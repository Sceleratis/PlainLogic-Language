// Reference implementation of examples/mixed-total.plog (PlainLogic 0.2).
//
// Mapping notes:
// - The prose steps map to an accumulator loop; the one exact branch
//   (`if value > 0`) keeps its structure verbatim.
// - List[Int] -> number[]; Int -> number; snake_case names -> camelCase.

export function totalPositive(values: number[]): number {
  let total = 0;
  for (const value of values) {
    if (value > 0) {
      total += value;
    }
  }
  return total;
}
