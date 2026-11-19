import { expect, type Locator, type Page } from '@playwright/test';

/** Home's button: the first icon of the rail (the toolbar has no Home tab). */
export const railHome = (page: Page) => page.locator('#library-rail').getByRole('button', { name: 'Home', exact: true });

/** The toolbar's tabs have no format badge: each carries its format, upper case, in `data-format`. Waits until the tabs' formats are `expected`, in order. */
export const expectFormats = (tabs: Locator, expected: string[]) =>
  expect.poll(() => tabs.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.format))).toEqual(expected);
