import { expect, test } from '@playwright/test';
import { createState, orderedOverageState } from './fixtures/scenarios.js';
import { SimulatorPage } from './pages/simulator-page.js';

test('summary and gauges agree with served, metered, and blocked rows', async ({ page }) => {
    const state = createState({
        enterprise: {
            businessSeats: 3,
            meteredEnabled: true,
            enterpriseBudget: 10,
            enterpriseHardStop: true
        },
        costCenters: [{
            id: 'cc-served',
            name: 'Served CC',
            teamIds: [],
            orgIds: [],
            userIds: ['user-served'],
            poolEnabled: true,
            overagesAllowed: true,
            budget: null,
            budgetHardStop: true,
            ulb: null
        }],
        users: [
            { id: 'user-served', name: 'Served', license: 'business', individualULB: null },
            { id: 'user-metered', name: 'Metered', license: 'business', individualULB: null },
            { id: 'user-blocked', name: 'Blocked', license: 'business', individualULB: 100 }
        ],
        usage: {
            'user-served': 1000,
            'user-metered': 4000,
            'user-blocked': 500
        }
    });
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    await simulator.expectStatus('user-served', 'served', /CC pool/);
    await simulator.expectStatus('user-metered', 'metered', /200 AI credits metered/);
    await simulator.expectStatus('user-blocked', 'blocked', /ULB exceeded/);
    expect(await simulator.summary('served')).toBe('1');
    expect(await simulator.summary('metered')).toBe('1');
    expect(await simulator.summary('blocked')).toBe('1');
    expect(await simulator.summary('metered-total')).toBe('200 AI credits');
    expect(await simulator.gaugeValues('cc-pool-cc-served')).toMatchObject({
        used: '1,000 AI credits',
        total: '1,900 AI credits'
    });
    expect(await simulator.gaugeValues('enterprise-budget')).toMatchObject({
        used: '200 AI credits',
        total: '1,000 AI credits',
        percent: '20.0%'
    });
});

test('switching display units preserves usage and status', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(orderedOverageState());
    await simulator.setUsage('user-thierry', 1960);

    await simulator.switchUnit('dollars');
    expect(await simulator.usageValue('user-thierry')).toBe(19.6);
    await simulator.expectStatus('user-thierry', 'metered', /\$0\.60 metered/);
    expect(await simulator.summary('metered-total')).toBe('$0.60');
    expect((await simulator.persistedState()).usage['user-thierry']).toBe(1960);

    await simulator.switchUnit('credits');
    expect(await simulator.usageValue('user-thierry')).toBe(1960);
    await simulator.expectStatus('user-thierry', 'metered', /60 AI credits metered/);
});

test('filtering users changes visibility without mutating simulation state', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(orderedOverageState());
    await simulator.setUsage('user-thierry', 1930);
    const before = await simulator.persistedState();

    await page.locator('#simUserFilter').fill('thier');
    await expect(simulator.row('user-thierry')).toBeVisible();
    await expect(simulator.row('user-philippe')).toBeHidden();
    await expect(simulator.row('user-matthieu')).toBeHidden();

    const after = await simulator.persistedState();
    expect(after.usage).toEqual(before.usage);
    expect(after.usageSequence).toEqual(before.usageSequence);
});
