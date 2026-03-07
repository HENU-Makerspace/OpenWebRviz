import { test, expect } from '@playwright/test';

test.describe('WebBot-Viz', () => {
  test('page loads and shows title', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'WebBot-Viz' })).toBeVisible();
  });

  test('shows connection status', async ({ page }) => {
    await page.goto('/');
    // Connection status component should exist
    await expect(page.locator('.text-gray-500').first()).toBeVisible();
  });

  test('sidebar shows layers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Layers' })).toBeVisible();
    await expect(page.getByText('Map', { exact: true })).toBeVisible();
    await expect(page.getByText('Robot (TF)', { exact: true })).toBeVisible();
    await expect(page.getByText('Local Plan', { exact: true })).toBeVisible();
  });

  test('layer toggle works', async ({ page }) => {
    await page.goto('/');

    // Find and click Map checkbox
    const mapCheckbox = page.getByRole('checkbox', { name: 'Map' });
    await expect(mapCheckbox).toBeChecked();

    // Uncheck it
    await mapCheckbox.uncheck();
    await expect(mapCheckbox).not.toBeChecked();

    // Check it again
    await mapCheckbox.check();
    await expect(mapCheckbox).toBeChecked();
  });

  test('shows data reception controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Data Reception' })).toBeVisible();
    await expect(page.getByText('Pause data reception')).toBeVisible();
    await expect(page.getByRole('combobox')).toBeVisible();
  });

  test('pause checkbox works', async ({ page }) => {
    await page.goto('/');

    const pauseCheckbox = page.getByRole('checkbox', { name: 'Pause data reception' });
    await expect(pauseCheckbox).not.toBeChecked();

    await pauseCheckbox.check();
    await expect(pauseCheckbox).toBeChecked();

    await pauseCheckbox.uncheck();
    await expect(pauseCheckbox).not.toBeChecked();
  });

  test('debug toggle shows/hides panel', async ({ page }) => {
    await page.goto('/');

    // Debug panel should be hidden initially
    await expect(page.getByText('FPS:')).not.toBeVisible();

    // Click Show Debug button
    await page.getByRole('button', { name: 'Show Debug' }).click();

    // Debug panel should be visible
    await expect(page.getByText('FPS:')).toBeVisible();

    // Click Hide Debug button
    await page.getByRole('button', { name: 'Hide Debug' }).click();

    // Debug panel should be hidden
    await expect(page.getByText('FPS:')).not.toBeVisible();
  });

  test('canvas renders', async ({ page }) => {
    await page.goto('/');
    // Canvas element should exist
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('rate selector changes value', async ({ page }) => {
    await page.goto('/');

    const rateSelect = page.getByRole('combobox');
    await expect(rateSelect).toHaveValue('0');

    await rateSelect.selectOption('5');
    await expect(rateSelect).toHaveValue('5');

    await rateSelect.selectOption('10');
    await expect(rateSelect).toHaveValue('10');
  });
});
