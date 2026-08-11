import { expect, test } from '@playwright/test';
import {
    BUSINESS_CREDITS,
    createState,
    orderedOverageState,
    singleUserState
} from './fixtures/scenarios.js';
import { SimulatorPage } from './pages/simulator-page.js';

for (const scenario of [
    {
        usage: BUSINESS_CREDITS - 1,
        status: 'served',
        detail: /Enterprise pool/,
        next: 'served',
        pool: '1,899 AI credits'
    },
    {
        usage: BUSINESS_CREDITS,
        status: 'served',
        detail: /Enterprise pool/,
        next: 'metered',
        pool: '1,900 AI credits'
    },
    {
        usage: BUSINESS_CREDITS + 1,
        status: 'metered',
        detail: /1 AI credits metered/,
        next: 'metered',
        pool: '1,900 AI credits'
    }
]) {
    test(`routes unassigned usage at ${scenario.usage} credits`, async ({ page }) => {
        const simulator = new SimulatorPage(page);
        await simulator.load(singleUserState({ usage: scenario.usage }));
        await simulator.expectStatus('user-alice', scenario.status, scenario.detail);
        await simulator.expectNextStatus('user-alice', scenario.next);
        expect(await simulator.gaugeValues('enterprise-pool')).toMatchObject({
            used: scenario.pool,
            total: '1,900 AI credits'
        });
    });
}

test('serves a cost-center member from its reserved pool', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(singleUserState({ usage: 1000, ccPoolEnabled: true }));

    await simulator.expectStatus('user-alice', 'served', /^1,000 AI credits CC pool$/);
    await simulator.expectNextStatus('user-alice', 'served');
    expect(await simulator.costCenter('user-alice')).toBe('Engineering');
    expect(await simulator.gaugeValues('cc-pool-cc-engineering')).toEqual({
        used: '1,000 AI credits',
        total: '1,900 AI credits',
        percent: '52.6%'
    });
});

test('last-call details omit funding sources that consumed nothing', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(singleUserState({ usage: 2000, ccPoolEnabled: true }));

    await simulator.expectStatus(
        'user-alice',
        'metered',
        /^1,900 AI credits CC pool \+ 100 AI credits metered$/
    );
    expect(await simulator.details('user-alice')).not.toContain('Enterprise pool');
});

test('falls through from an exhausted cost-center pool to available enterprise pool', async ({ page }) => {
    const state = singleUserState({ usage: 2000, ccPoolEnabled: true });
    state.enterprise.businessSeats = 2;
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    await simulator.expectStatus('user-alice', 'served', /CC pool.*Enterprise pool/);
    await simulator.expectNextStatus('user-alice', 'served');
    expect(await simulator.gaugeValues('cc-pool-cc-engineering')).toMatchObject({
        used: '1,900 AI credits',
        percent: '100.0%'
    });
    expect(await simulator.gaugeValues('enterprise-pool')).toMatchObject({
        used: '100 AI credits',
        total: '1,900 AI credits'
    });
});

test('blocks at an exhausted cost-center pool when overages are disabled', async ({ page }) => {
    const state = singleUserState({
        usage: 2000,
        ccPoolEnabled: true,
        overagesAllowed: false
    });
    state.enterprise.businessSeats = 2;
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    await simulator.expectStatus(
        'user-alice',
        'blocked',
        /CC pool exhausted & overages not allowed/
    );
    await simulator.expectNextStatus(
        'user-alice',
        'blocked',
        /CC pool exhausted & overages not allowed/
    );
    expect(await simulator.gaugeValues('enterprise-pool')).toMatchObject({
        used: '0 AI credits',
        total: '1,900 AI credits'
    });
});

test('consumes a residual cost-center pool in FIFO order', async ({ page }) => {
    const state = orderedOverageState();
    state.costCenters[0].poolEnabled = true;
    state.costCenters[0].budget = 0;
    for (const user of state.users) {
        state.usage[user.id] = 2000;
        state.usageBaseline[user.id] = 1800;
    }
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    await simulator.expectStatus('user-philippe', 'served', /CC pool/);
    for (const userId of ['user-matthieu', 'user-thierry']) {
        await simulator.expectStatus(userId, 'blocked', /CC budget exhausted/);
    }
    for (const user of state.users) {
        await simulator.expectNextStatus(user.id, 'blocked', /CC budget exhausted/);
    }
    expect(await simulator.gaugeValues('cc-pool-cc-rnd')).toEqual({
        used: '5,700 AI credits',
        total: '5,700 AI credits',
        percent: '100.0%'
    });
});

test('consumes residual enterprise capacity in FIFO order', async ({ page }) => {
    const ids = ['user-a', 'user-b', 'user-c'];
    const state = createState({
        enterprise: {
            businessSeats: 3,
            enterpriseBudget: 0,
            enterpriseHardStop: true,
            meteredEnabled: true
        },
        users: ids.map((id, index) => ({
            id,
            name: `User ${index + 1}`,
            license: 'business',
            individualULB: null
        })),
        usage: Object.fromEntries(ids.map(id => [id, 2000])),
        usageBaseline: Object.fromEntries(ids.map(id => [id, 1800]))
    });
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    await simulator.expectStatus('user-a', 'served', /Enterprise pool/);
    for (const id of ['user-b', 'user-c']) {
        await simulator.expectStatus(id, 'blocked', /Enterprise budget exhausted/);
    }
    for (const id of ids) {
        await simulator.expectNextStatus(id, 'blocked', /Enterprise budget exhausted/);
    }
    expect(await simulator.gaugeValues('enterprise-pool')).toEqual({
        used: '5,700 AI credits',
        total: '5,700 AI credits',
        percent: '100.0%'
    });
});
