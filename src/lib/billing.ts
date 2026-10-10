// India textile GST — kept as one constant so it's visible and easy to correct
// for the real slab rather than buried in a calculation.
export const GST_RATE = 0.05;

export function computeInvoiceTotals(subtotal: number) {
  const gst = Math.round(subtotal * GST_RATE * 100) / 100;
  const total = Math.round((subtotal + gst) * 100) / 100;
  return { gst, total };
}
