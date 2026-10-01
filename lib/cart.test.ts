/* eslint-disable @typescript-eslint/no-require-imports */
const { cartTotal } = require("./cart");

interface Item {
  price: number;
  quantity: number;
}

// Helper function for assertions
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 0.0001) {
    throw new Error(
      `Assertion failed: ${message}. Expected ${expected}, got ${actual}`
    );
  }
}

function assertThrows(
  fn: () => void,
  expectedMessage: string,
  testName: string
): void {
  try {
    fn();
    throw new Error(
      `Test failed: ${testName} - Expected error but none was thrown`
    );
  } catch (error) {
    if (error instanceof Error) {
      assert(
        error.message.includes(expectedMessage),
        `${testName} - Expected error message to include "${expectedMessage}", got "${error.message}"`
      );
    } else {
      throw new Error(`Test failed: ${testName} - Unexpected error type`);
    }
  }
}

// Test: Single item without discount
function singleItemNoDiscount(): void {
  const items: Item[] = [{ price: 100, quantity: 1 }];
  const result = cartTotal(items);
  assertEqual(
    result,
    100,
    "Single item without discount should return 100"
  );
}

// Test: Multiple items without discount
function multipleItemsNoDiscount(): void {
  const items: Item[] = [
    { price: 50, quantity: 2 },
    { price: 30, quantity: 1 },
  ];
  const result = cartTotal(items);
  assertEqual(
    result,
    130,
    "Multiple items without discount should return 130 (50*2 + 30*1)"
  );
}

// Test: Single item with SAVE10 discount (10% off)
function singleItemWithDiscount(): void {
  const items: Item[] = [{ price: 100, quantity: 1 }];
  const result = cartTotal(items, "SAVE10");
  assertEqual(result, 90, "Single item with SAVE10 discount should be 90 (100 * 0.9)");
}

// Test: Multiple items with SAVE10 discount (10% off)
function multipleItemsWithDiscount(): void {
  const items: Item[] = [
    { price: 50, quantity: 2 },
    { price: 30, quantity: 1 },
  ];
  const result = cartTotal(items, "SAVE10");
  assertEqual(
    result,
    117,
    "Multiple items with SAVE10 discount should be 117 (130 * 0.9)"
  );
}

// Test: Empty cart
function emptyCart(): void {
  const items: Item[] = [];
  const result = cartTotal(items);
  assertEqual(result, 0, "Empty cart should return 0");
}

// Test: Null items handled as empty
function nullItems(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = cartTotal(null as any);
  assertEqual(result, 0, "Null items should return 0");
}

// Test: Invalid discount code is ignored
function invalidDiscountCode(): void {
  const items: Item[] = [{ price: 100, quantity: 1 }];
  const result = cartTotal(items, "INVALID");
  assertEqual(result, 100, "Invalid discount code should be ignored");
}

// Test: Negative price throws error
function negativePrice(): void {
  const items: Item[] = [{ price: -50, quantity: 1 }];
  assertThrows(
    () => cartTotal(items),
    "Price cannot be negative",
    "Negative price should throw error"
  );
}

// Test: Zero quantity throws error
function zeroQuantity(): void {
  const items: Item[] = [{ price: 50, quantity: 0 }];
  assertThrows(
    () => cartTotal(items),
    "Quantity must be positive",
    "Zero quantity should throw error"
  );
}

// Test: Negative quantity throws error
function negativeQuantity(): void {
  const items: Item[] = [{ price: 50, quantity: -1 }];
  assertThrows(
    () => cartTotal(items),
    "Quantity must be positive",
    "Negative quantity should throw error"
  );
}

// Test: Multiple items with some edge case quantities
function multipleItemsEdgeCases(): void {
  const items: Item[] = [
    { price: 10, quantity: 5 },
    { price: 0, quantity: 100 }, // Zero price is valid
  ];
  const result = cartTotal(items);
  assertEqual(
    result,
    50,
    "Multiple items with zero price should calculate correctly (10*5 + 0*100)"
  );
}

// Run all tests
function runAllTests(): void {
  const tests: Array<{ name: string; fn: () => void }> = [
    { name: "Single item without discount", fn: singleItemNoDiscount },
    { name: "Multiple items without discount", fn: multipleItemsNoDiscount },
    {
      name: "Single item with SAVE10 discount",
      fn: singleItemWithDiscount,
    },
    {
      name: "Multiple items with SAVE10 discount",
      fn: multipleItemsWithDiscount,
    },
    { name: "Empty cart", fn: emptyCart },
    { name: "Null items handled as empty", fn: nullItems },
    { name: "Invalid discount code is ignored", fn: invalidDiscountCode },
    { name: "Negative price throws error", fn: negativePrice },
    { name: "Zero quantity throws error", fn: zeroQuantity },
    { name: "Negative quantity throws error", fn: negativeQuantity },
    {
      name: "Multiple items with edge case quantities",
      fn: multipleItemsEdgeCases,
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      test.fn();
      console.log(`✓ ${test.name}`);
      passed++;
    } catch (error) {
      console.error(`✗ ${test.name}`);
      if (error instanceof Error) {
        console.error(`  ${error.message}`);
      }
      failed++;
    }
  }

  console.log(`\nTests: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Export for use in other environments
export {
  singleItemNoDiscount,
  multipleItemsNoDiscount,
  singleItemWithDiscount,
  multipleItemsWithDiscount,
  emptyCart,
  nullItems,
  invalidDiscountCode,
  negativePrice,
  zeroQuantity,
  negativeQuantity,
  multipleItemsEdgeCases,
};

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}
