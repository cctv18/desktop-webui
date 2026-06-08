function assert(value: unknown, message?: string): asserts value {
  if (!value) {
    throw new Error(message ?? 'Assertion failed')
  }
}

export const ok = assert

export function fail(message?: string): never {
  throw new Error(message ?? 'Assertion failed')
}

export function equal(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    fail(message ?? `Expected ${actual} to equal ${expected}`)
  }
}

export function strictEqual(
  actual: unknown,
  expected: unknown,
  message?: string
) {
  if (actual !== expected) {
    fail(message ?? `Expected ${actual} to strictly equal ${expected}`)
  }
}

export function deepStrictEqual(
  actual: unknown,
  expected: unknown,
  message?: string
) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(message ?? 'Expected values to be deeply equal')
  }
}

export const strict = Object.assign(assert, {
  deepStrictEqual,
  equal,
  fail,
  ok,
  strictEqual,
})

export default Object.assign(assert, {
  deepStrictEqual,
  equal,
  fail,
  ok,
  strict,
  strictEqual,
})
