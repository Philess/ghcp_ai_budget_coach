import { expect, test } from '@playwright/test';
import {
    BUSINESS_CREDITS,
    createState,
    independentCostCenterBudgetState,
    membershipState,
    orderedOverageState,
    singleUserState
} from './fixtures/scenarios.js';
import { SimulatorPage } from './pages/simulator-page.js';

function percentValue(text) {
    return Number.parseFloat(text.replace('%', ''));
}

test('blocks after pool exhaustion when metered usage is disabled', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(singleUserState({
        usage: BUSINESS_CREDITS + 1,
        meteredEnabled: false
    }));
    await simulator.expectStatus('user-alice', 'blocked', /metered usage not enabled/);
    await simulator.expectNextStatus('user-alice', 'blocked', /metered usage not enabled/);
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
            await simulator.expectNextStatus(
                'user-alice',
                boundary.overage < 100 ? 'metered' : 'blocked',
                boundary.overage < 100 ? undefined : reason
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
    await simulator.expectNextStatus('user-alice', 'blocked', /Org budget exhausted/);
});

test('zero-dollar cost-center hard stop blocks the first metered credit', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(singleUserState({
        usage: BUSINESS_CREDITS + 1,
        ccBudget: 0
    }));
    await simulator.expectStatus('user-alice', 'blocked', /CC budget exhausted/);
    await simulator.expectNextStatus('user-alice', 'blocked', /CC budget exhausted/);
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

        await simulator.switchUnit('dollars');
        const dollars = (meteredCredits / 100).toFixed(2);
        await simulator.expectStatus('user-alice', 'metered', new RegExp(`\\$${dollars} metered`));
        expect(await simulator.summary('metered-total')).toBe(`$${dollars}`);
        expect(await simulator.gaugeValues('enterprise-budget')).toMatchObject({ used: `$${dollars}` });
    });
}

test('cost-center hard-stop exhaustion freezes next calls for all members in that scope', async ({ page }) => {
    const state = orderedOverageState();
    state.usage['user-matthieu'] = BUSINESS_CREDITS + 101;
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    await simulator.expectStatus('user-philippe', 'served');
    await simulator.expectStatus('user-matthieu', 'blocked', /CC budget exhausted/);
    await simulator.expectStatus('user-thierry', 'served');
    for (const user of state.users) {
        await simulator.expectNextStatus(user.id, 'blocked', /CC budget exhausted/);
    }
});

test('organization hard-stop exhaustion freezes next calls for all active members', async ({ page }) => {
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

    await simulator.expectStatus('user-a', 'served');
    await simulator.expectStatus('user-b', 'blocked', /Org budget exhausted/);
    for (const id of ids) {
        await simulator.expectNextStatus(id, 'blocked', /Org budget exhausted/);
    }
});

test('enterprise hard-stop exhaustion preserves pool-served history but blocks next calls', async ({ page }) => {
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
    await simulator.expectNextStatus('user-pool', 'blocked', /Enterprise budget exhausted/);
    await simulator.expectNextStatus('user-overage', 'blocked', /Enterprise budget exhausted/);
});

test('universal ULB allows its exact boundary and blocks one credit above', async ({ page }) => {
    const state = singleUserState({
        usage: 2000,
        universalULB: 2000
    });
    const simulator = new SimulatorPage(page);
    await simulator.load(state);
    await simulator.expectStatus('user-alice', 'metered', /100 AI credits metered/);
    await simulator.expectNextStatus('user-alice', 'blocked', /ULB exceeded.*Universal/);
    expect(await simulator.ulbTotal('user-alice')).toBe('/2,000');

    await simulator.setUsage('user-alice', 2001);
    await simulator.expectStatus('user-alice', 'blocked', /ULB exceeded.*Universal/);
    await simulator.expectNextStatus('user-alice', 'blocked', /ULB exceeded.*Universal/);
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
    expect(await simulator.ulbTotal('user-alice')).toBe('/1,300');
});

test('cost-center ULB overrides universal for resolved team membership', async ({ page }) => {
    const state = membershipState();
    state.enterprise.universalULB = 50;
    state.costCenters.find(costCenter => costCenter.id === 'cc-team').ulb = 100;
    state.usage['user-team'] = 75;
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    await simulator.expectStatus('user-team', 'served', /CC pool/);
    expect(await simulator.ulbTotal('user-team')).toBe('/100');
    await expect(simulator.row('user-team').locator('[data-role="ulb-total"]'))
        .toHaveAttribute('title', /CC: Team CC/);
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

test('syncs cost-center budget independence between the budgets panel and dashboard controls', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(independentCostCenterBudgetState());
    await simulator.showPanel('budgets');

    const budgetsCheckbox = page.locator('#costCenterBudgetsIndependent');
    await budgetsCheckbox.check();
    await expect(budgetsCheckbox).toBeChecked();

    await page.getByRole('button', { name: /Dashboard/ }).click();
    const dashboardCheckbox = page.locator('#globalBudgetControls [data-bind="costCenterBudgetsIndependent"]');
    await expect(dashboardCheckbox).toBeChecked();

    await dashboardCheckbox.uncheck();
    await expect(dashboardCheckbox).not.toBeChecked();

    await simulator.showPanel('budgets');
    await expect(page.locator('#costCenterBudgetsIndependent')).not.toBeChecked();
});

test('persists cost-center budget independence when confirmed from wizard step 6', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.loadEmpty();

    await page.getByRole('button', { name: /Setup Wizard/ }).click();
    for (let step = 0; step < 5; step += 1) {
        await page.getByRole('button', { name: /Next/ }).click();
    }

    await page.locator('#wizardEntBudget').fill('100');
    await page.locator('#wizardEntIndependent').check();
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Confirm & Create/ }).click();
    await expect(page.locator('#wizardBody')).toContainText('Setup Complete');
    await page.getByRole('button', { name: /Close/ }).click();

    await simulator.showPanel('budgets');
    await expect(page.locator('#costCenterBudgetsIndependent')).toBeChecked();
    expect((await simulator.persistedState()).enterprise.costCenterBudgetsIndependent).toBe(true);
});

test('enterprise overage slider excludes independent cost-center users and preserves their budget gauge', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(independentCostCenterBudgetState());

    await page.locator('#globalBudgetControls [data-bind="costCenterBudgetsIndependent"]').check();
    await simulator.setGlobalPercent('enterpriseOverage', 50);

    const enterpriseGauge = await simulator.gaugeValues('enterprise-budget');
    const costCenterGauge = await simulator.gaugeValues('cc-budget-cc-rnd');

    expect(percentValue(enterpriseGauge.percent)).toBeGreaterThanOrEqual(49.5);
    expect(percentValue(enterpriseGauge.percent)).toBeLessThanOrEqual(50.5);
    expect(percentValue(costCenterGauge.percent)).toBeLessThan(1);
});

test('enterprise overage user counts reflect independence-aware targeting', async ({ page }) => {
    const state = independentCostCenterBudgetState();
    const simulator = new SimulatorPage(page);
    await simulator.load(state);

    const independentMembers = state.costCenters[0].userIds.length;
    const expectedEnterpriseTargets = state.users.length - independentMembers;

    await page.locator('#globalBudgetControls [data-bind="costCenterBudgetsIndependent"]').check();
    await expect(simulator.budgetControl('enterpriseOverage').locator('.badge'))
        .toHaveText(`${expectedEnterpriseTargets} users`);
});
