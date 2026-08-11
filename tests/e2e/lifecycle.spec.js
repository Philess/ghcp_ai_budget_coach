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

test('loads and persists the bundled sample configuration', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.loadEmpty();

    await page.locator('#dashboardEmpty').getByRole('button', { name: /Load sample data/ }).click();
    await expect(simulator.row('user_1783340586171')).toContainText('Philippe');
    await expect(page.locator('#dashboardContent')).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    const state = await simulator.persistedState();
    expect(state.users).toHaveLength(23);
    expect(state.costCenters).toHaveLength(2);
    expect(state.enterprise).toMatchObject({
        businessSeats: 22,
        enterpriseSeats: 1,
        enterpriseBudget: 3000
    });
    await expect(simulator.row('user_1783340586171')).toBeVisible();
});

test('confirms before replacing existing configuration with sample data', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(orderedOverageState());
    const sampleButton = page.locator('header').getByRole('button', { name: /Load sample data/ });

    page.once('dialog', dialog => dialog.dismiss());
    await sampleButton.click();
    await expect(simulator.row('user-philippe')).toBeVisible();
    expect((await simulator.persistedState()).users[0].id).toBe('user-philippe');

    page.once('dialog', dialog => dialog.accept());
    await sampleButton.click();
    await expect(simulator.row('user_1783340586171')).toContainText('Philippe');
    await expect(simulator.row('user-philippe')).toHaveCount(0);
});

for (const scenario of [
    {
        name: 'request failure',
        alert: /Request failed with status 500/,
        route: route => route.fulfill({ status: 500, body: 'Server error' })
    },
    {
        name: 'malformed JSON',
        alert: /JSON/,
        route: route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{'
        })
    }
]) {
    test(`preserves existing configuration when sample load has ${scenario.name}`, async ({ page }) => {
        const simulator = new SimulatorPage(page);
        await simulator.load(orderedOverageState());
        const before = await simulator.persistedState();
        const sampleButton = page.locator('header').getByRole('button', { name: /Load sample data/ });
        await page.route('**/budget-simulator-sample.json', scenario.route);

        const alertPromise = new Promise(resolve => {
            page.on('dialog', async dialog => {
                if (dialog.type() === 'confirm') {
                    await dialog.accept();
                    return;
                }
                const message = dialog.message();
                await dialog.accept();
                resolve(message);
            });
        });

        await sampleButton.click();
        await expect(await alertPromise).toMatch(scenario.alert);
        await expect(simulator.row('user-philippe')).toBeVisible();
        await expect(simulator.row('user_1783340586171')).toHaveCount(0);
        expect(await simulator.persistedState()).toEqual(before);
    });
}

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
