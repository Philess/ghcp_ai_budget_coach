import { expect, test } from '@playwright/test';
import { BUSINESS_CREDITS, orderedOverageState } from './fixtures/scenarios.js';
import { SimulatorPage } from './pages/simulator-page.js';

const PHILIPPE = 'user-philippe';
const MATTHIEU = 'user-matthieu';
const THIERRY = 'user-thierry';

test('sets a concurrently consumed global baseline', async ({ page }) => {
    const state = orderedOverageState();
    state.usage = {};
    state.usageBaseline = {};
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    await simulator.setGlobalPercent('enterprisePool', 100);
    for (const userId of [PHILIPPE, MATTHIEU, THIERRY]) {
        expect(await simulator.usageValue(userId)).toBe(BUSINESS_CREDITS);
        await simulator.expectStatus(userId, 'served', /Enterprise pool/);
    }
    await simulator.setStartingPoint();

    await expect(page.locator('#startingPointStatus')).toContainText('5,700 AI credits');
    const persisted = await simulator.persistedState();
    expect(persisted.usageBaseline).toEqual({
        [PHILIPPE]: BUSINESS_CREDITS,
        [MATTHIEU]: BUSINESS_CREDITS,
        [THIERRY]: BUSINESS_CREDITS
    });
    expect(persisted.usageSequence).toEqual([]);
});

test('transitions served to metered to blocked in browser edit order', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(orderedOverageState());

    for (const userId of [PHILIPPE, MATTHIEU, THIERRY]) {
        await simulator.expectStatus(userId, 'served', /Enterprise pool/);
    }

    await simulator.setUsage(THIERRY, 1960);
    await simulator.expectStatus(THIERRY, 'metered', /60 AI credits metered/);
    await simulator.expectStatus(MATTHIEU, 'served');
    await simulator.expectStatus(PHILIPPE, 'served');
    expect(await simulator.gaugeValues('cc-budget-cc-rnd')).toMatchObject({
        used: '60 AI credits',
        percent: '60.0%'
    });

    await simulator.setUsage(MATTHIEU, 1940);
    await simulator.expectStatus(THIERRY, 'metered', /60 AI credits metered/);
    await simulator.expectStatus(MATTHIEU, 'metered', /40 AI credits metered/);
    await simulator.expectStatus(PHILIPPE, 'served');
    expect(await simulator.gaugeValues('cc-budget-cc-rnd')).toEqual({
        used: '100 AI credits',
        total: '100 AI credits',
        percent: '100.0%'
    });

    await simulator.setUsage(PHILIPPE, 1910);
    for (const userId of [PHILIPPE, MATTHIEU, THIERRY]) {
        await simulator.expectStatus(userId, 'blocked', /CC budget exhausted/);
    }

    const persisted = await simulator.persistedState();
    expect(persisted.usageSequence).toEqual([THIERRY, MATTHIEU, PHILIPPE]);
});

test('reverse edit order is recorded while final hard-stop propagation stays scope-wide', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(orderedOverageState());

    await simulator.setUsage(PHILIPPE, 1960);
    await simulator.setUsage(MATTHIEU, 1940);
    await simulator.setUsage(THIERRY, 1910);

    expect((await simulator.persistedState()).usageSequence)
        .toEqual([PHILIPPE, MATTHIEU, THIERRY]);
    for (const userId of [PHILIPPE, MATTHIEU, THIERRY]) {
        await simulator.expectStatus(userId, 'blocked', /CC budget exhausted/);
    }
});

test('re-editing a user records the latest effective application position', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(orderedOverageState());

    await simulator.setUsage(THIERRY, 1930);
    await simulator.setUsage(MATTHIEU, 1940);
    await simulator.setUsage(THIERRY, 1920);

    expect((await simulator.persistedState()).usageSequence)
        .toEqual([THIERRY, MATTHIEU, THIERRY]);
    await simulator.expectStatus(THIERRY, 'metered', /20 AI credits metered/);
    await simulator.expectStatus(MATTHIEU, 'metered', /40 AI credits metered/);
});

test('global redistribution and a new starting point clear per-user edit order', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(orderedOverageState());

    await simulator.setUsage(THIERRY, 1930);
    expect((await simulator.persistedState()).usageSequence).toEqual([THIERRY]);

    await simulator.setGlobalPercent('enterprisePool', 50);
    let state = await simulator.persistedState();
    expect(state.usageSequence).toEqual([]);
    expect(Object.values(state.usage)).toEqual([950, 950, 950]);

    await simulator.setUsage(MATTHIEU, 1000);
    expect((await simulator.persistedState()).usageSequence).toEqual([MATTHIEU]);
    await simulator.setStartingPoint();
    state = await simulator.persistedState();
    expect(state.usageSequence).toEqual([]);
    expect(state.usageBaseline).toEqual(state.usage);
});

test('reset usage clears values, baseline, percentages, and sequence', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(orderedOverageState());
    await simulator.setUsage(THIERRY, 1930);
    await simulator.resetUsage();

    const state = await simulator.persistedState();
    expect(state.usage).toEqual({});
    expect(state.usageBaseline).toEqual({});
    expect(state.globalBudgetPercents).toEqual({});
    expect(state.usageSequence).toEqual([]);
    for (const userId of [PHILIPPE, MATTHIEU, THIERRY]) {
        expect(await simulator.usageValue(userId)).toBe(0);
        await simulator.expectStatus(userId, 'served', /No usage/);
    }
});

test('reload preserves baseline, edit order, and visible outcomes', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(orderedOverageState());
    await simulator.setUsage(THIERRY, 1960);
    await simulator.setUsage(MATTHIEU, 1940);

    await page.reload();
    await page.waitForLoadState('networkidle');

    expect((await simulator.persistedState()).usageSequence).toEqual([THIERRY, MATTHIEU]);
    await simulator.expectStatus(THIERRY, 'metered', /60 AI credits metered/);
    await simulator.expectStatus(MATTHIEU, 'metered', /40 AI credits metered/);
    await simulator.expectStatus(PHILIPPE, 'served');
});
