import { expect, test } from '@playwright/test';
import {
    BUSINESS_CREDITS,
    createState,
    membershipState,
    orderedOverageState,
    singleUserState
} from './fixtures/scenarios.js';
import { SimulatorPage } from './pages/simulator-page.js';

test('blocks after pool exhaustion when metered usage is disabled', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(singleUserState({
        usage: BUSINESS_CREDITS + 1,
        meteredEnabled: false
    }));
    await simulator.expectStatus('user-alice', 'blocked', /metered usage not enabled/);
});

for (const scope of ['cc', 'org', 'enterprise']) {
    for (const boundary of [
        { overage: 99, status: 'metered' },
        { overage: 100, status: 'metered' },
        { overage: 101, status: 'blocked' }
    ]) {
        test(`${scope} hard stop handles ${boundary.overage} metered credits`, async ({ page }) => {
            const options = {
                usage: BUSINESS_CREDITS + boundary.overage,
                enterpriseBudget: scope === 'enterprise' ? 1 : 1000
            };
            if (scope === 'cc') options.ccBudget = 1;
            if (scope === 'org') options.orgBudget = 1;
            const simulator = new SimulatorPage(page);
            await simulator.load(singleUserState(options));

            const reason = scope === 'cc'
                ? /CC budget exhausted/
                : scope === 'org'
                    ? /Org budget exhausted/
                    : /Enterprise budget exhausted/;
            await simulator.expectStatus(
                'user-alice',
                boundary.status,
                boundary.status === 'blocked' ? reason : new RegExp(`${boundary.overage} AI credits metered`)
            );
        });
    }
}

for (const scope of ['cc', 'org', 'enterprise']) {
    test(`${scope} soft stop permits usage beyond its configured budget`, async ({ page }) => {
        const options = {
            usage: BUSINESS_CREDITS + 200,
            enterpriseBudget: scope === 'enterprise' ? 1 : 1000,
            enterpriseHardStop: scope !== 'enterprise'
        };
        if (scope === 'cc') {
            options.ccBudget = 1;
            options.ccHardStop = false;
        }
        if (scope === 'org') {
            options.orgBudget = 1;
            options.orgHardStop = false;
        }
        const simulator = new SimulatorPage(page);
        await simulator.load(singleUserState(options));

        await simulator.expectStatus('user-alice', 'metered', /200 AI credits metered/);
        const gaugeKey = scope === 'cc'
            ? 'cc-budget-cc-engineering'
            : scope === 'org'
                ? 'org-budget-org-acme'
                : 'enterprise-budget';
        expect(await simulator.gaugeValues(gaugeKey)).toMatchObject({ percent: '200.0%' });
    });
}

test('smallest applicable scoped budget controls the result', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(singleUserState({
        usage: BUSINESS_CREDITS + 101,
        ccBudget: 2,
        orgBudget: 1,
        enterpriseBudget: 3
    }));

    await simulator.expectStatus('user-alice', 'blocked', /Org budget exhausted/);
});

test('zero-dollar cost-center hard stop blocks the first metered credit', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(singleUserState({
        usage: BUSINESS_CREDITS + 1,
        ccBudget: 0
    }));
    await simulator.expectStatus('user-alice', 'blocked', /CC budget exhausted/);
});

for (const meteredCredits of [1, 100, 101]) {
    test(`accounts for ${meteredCredits} metered credits`, async ({ page }) => {
        const simulator = new SimulatorPage(page);
        await simulator.load(singleUserState({
            usage: BUSINESS_CREDITS + meteredCredits,
            enterpriseBudget: 1,
            enterpriseHardStop: false
        }));

        await simulator.expectStatus(
            'user-alice',
            'metered',
            new RegExp(`${meteredCredits} AI credits metered`)
        );
        expect(await simulator.summary('metered-total')).toBe(`${meteredCredits} AI credits`);
        expect(await simulator.gaugeValues('enterprise-budget')).toMatchObject({
            used: `${meteredCredits} AI credits`
        });
    });
}

test('cost-center hard-stop exhaustion freezes pool-only members in that scope', async ({ page }) => {
    const state = orderedOverageState();
    state.usage['user-matthieu'] = BUSINESS_CREDITS + 101;
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    for (const user of state.users) {
        await simulator.expectStatus(user.id, 'blocked', /CC budget exhausted/);
    }
});

test('organization hard-stop exhaustion freezes all active organization members', async ({ page }) => {
    const ids = ['user-a', 'user-b'];
    const state = createState({
        enterprise: {
            businessSeats: 2,
            meteredEnabled: true,
            enterpriseBudget: 1000,
            enterpriseHardStop: true
        },
        orgs: [{ id: 'org-acme', name: 'Acme', budget: 1, budgetHardStop: true }],
        users: ids.map((id, index) => ({
            id,
            name: `User ${index + 1}`,
            license: 'business',
            orgId: 'org-acme',
            individualULB: null
        })),
        usage: { 'user-a': BUSINESS_CREDITS, 'user-b': BUSINESS_CREDITS + 101 },
        usageBaseline: { 'user-a': BUSINESS_CREDITS, 'user-b': BUSINESS_CREDITS }
    });
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    for (const id of ids) {
        await simulator.expectStatus(id, 'blocked', /Org budget exhausted/);
    }
});

test('enterprise hard-stop exhaustion leaves pool-only users served', async ({ page }) => {
    const state = createState({
        enterprise: {
            businessSeats: 2,
            meteredEnabled: true,
            enterpriseBudget: 1,
            enterpriseHardStop: true
        },
        users: [
            { id: 'user-pool', name: 'Pool User', license: 'business', individualULB: null },
            { id: 'user-overage', name: 'Overage User', license: 'business', individualULB: null }
        ],
        usage: {
            'user-pool': BUSINESS_CREDITS,
            'user-overage': BUSINESS_CREDITS + 101
        },
        usageBaseline: {
            'user-pool': BUSINESS_CREDITS,
            'user-overage': BUSINESS_CREDITS
        }
    });
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    await simulator.expectStatus('user-pool', 'served', /Enterprise pool/);
    await simulator.expectStatus('user-overage', 'blocked', /Enterprise budget exhausted/);
});

test('universal ULB allows its exact boundary and blocks one credit above', async ({ page }) => {
    const state = singleUserState({
        usage: 2000,
        universalULB: 2000
    });
    const simulator = new SimulatorPage(page);
    await simulator.load(state);
    await simulator.expectStatus('user-alice', 'metered', /100 AI credits metered/);

    await simulator.setUsage('user-alice', 2001);
    await simulator.expectStatus('user-alice', 'blocked', /ULB exceeded.*Universal/);
});

test('individual ULB overrides cost-center and universal budgets', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(singleUserState({
        usage: 1301,
        universalULB: 1000,
        ccULB: 2000,
        individualULB: 1300
    }));
    await simulator.expectStatus('user-alice', 'blocked', /ULB exceeded.*Individual/);
});

test('cost-center ULB overrides universal for resolved team membership', async ({ page }) => {
    const state = membershipState();
    state.enterprise.universalULB = 50;
    state.costCenters.find(costCenter => costCenter.id === 'cc-team').ulb = 100;
    state.usage['user-team'] = 75;
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    await simulator.expectStatus('user-team', 'served', /CC pool/);
    await expect(simulator.row('user-team').locator('[data-role="ulb-remaining"]'))
        .toHaveText('25 AI credits');
});

test('ULB blocks during included-pool phase and across a saved baseline', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(singleUserState({
        usage: 1960,
        baseline: 1900,
        universalULB: 1950
    }));
    await simulator.expectStatus('user-alice', 'blocked', /ULB exceeded.*Universal/);
    expect(await simulator.gaugeValues('enterprise-pool')).toMatchObject({
        used: '1,900 AI credits'
    });
});
