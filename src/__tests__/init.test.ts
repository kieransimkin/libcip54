
import { labelIsCIP68 } from '../index';

test('Label is CIP68', () => {
  expect(labelIsCIP68(31337)).toBe(false);
  expect(labelIsCIP68(100)).toBe(true);
  expect(labelIsCIP68(222)).toBe(true);
  expect(labelIsCIP68(223)).toBe(false);
});
