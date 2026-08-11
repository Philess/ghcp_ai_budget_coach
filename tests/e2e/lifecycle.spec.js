import { expect, test } from '@playwright/test';
import { orderedOverageState } from './fixtures/scenarios.js';
import { SimulatorPage } from './pages/simulator-page.js';

test('imports, normalizes, renders, and persists a configuration', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.loadEmpty();
    const imported = {
        enterprise: {
            businessSeats: 1,
            meteredEnabled: true,
            enterpriseBudget: 5
        },
        users: [{
            id: 'user-imported',
            name: 'Imported User',
            license: 'business',
            individualULB: null
        }],
        usage: { 'user-imported': 100 }
    };

    await page.locator('#importFile').setInputFiles({
        name: 'configuration.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(imported))
    });
    await expect(simulator.row('user-imported')).toBeVisible();
    await simulator.expectStatus('user-imported', 'served', /Enterprise pool/);

    await page.reload();
    await page.waitForLoadState('networkidle');
    const state = await simulator.persistedState();
    expect(state.enterprise).toMatchObject({
        businessSeats: 1,
        enterpriseSeats: 0,
        enterpriseBudget: 5,
        enterpriseHardStop: true
    });
    expect(state.usageBaseline).toEqual({});
    expect(state.usageSequence).toEqual([]);
    expect(state.globalBudgetPercents).toEqual({});
    await expect(simulator.row('user-imported')).toBeVisible();
});

test('canceling reset preserves state and confirming reset restores defaults', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(orderedOverageState());

    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: /Reset$/ }).click();
    await expect(simulator.row('user-philippe')).toBeVisible();

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: /Reset$/ }).click();
    await expect(page.locator('#dashboardEmpty')).toBeVisible();
    const state = await simulator.persistedState();
    expect(state.users).toEqual([]);
    expect(state.costCenters).toEqual([]);
    expect(state.enterprise.businessSeats).toBe(0);
    expect(state.enterprise.enterpriseSeats).toBe(0);
});
