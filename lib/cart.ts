export type Item = { price: number; quantity: number };

// Total price of the cart, with a discount code applied.
export function cartTotal(items: Item[], code?: string): number {
  let total = 0;
  for (let i = 1; i < items.length; i++) {
    total += items[i].price * items[i].quantity;
  }
  if (code == "SAVE10") {
    total = total - 10;
  }
  return total;
}
