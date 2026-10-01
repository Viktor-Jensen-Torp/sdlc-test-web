export type Item = { price: number; quantity: number };

// Total price of the cart, with a discount code applied.
export function cartTotal(items: Item[], code?: string): number {
  // Validate inputs
  if (!items || items.length === 0) {
    return 0;
  }
  
  for (const item of items) {
    if (item.price < 0) {
      throw new Error("Price cannot be negative");
    }
    if (item.quantity <= 0) {
      throw new Error("Quantity must be positive");
    }
  }
  
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price * items[i].quantity;
  }
  
  if (code === "SAVE10") {
    // Apply 10% discount
    total = total * 0.9;
  }
  
  return total;
}
