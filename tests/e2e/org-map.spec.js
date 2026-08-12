import { expect, test } from '@playwright/test';
import { createState } from './fixtures/scenarios.js';
import { SimulatorPage } from './pages/simulator-page.js';

function orgMapState() {
    const teamUsers = Array.from({ length: 9 }, (_, index) => ({
        id: `user-platform-${index + 1}`,
        name: `Platform User ${index + 1}`,
        license: 'business',
        teamId: 'team-platform',
        orgId: index === 0 ? 'org-product' : null,
        individualULB: index === 0 ? 900 : null
    }));
    const users = [
        ...teamUsers,
        {
            id: 'user-product',
            name: 'Product User',
            license: 'business',
            orgId: 'org-product',
            individualULB: null
        },
        {
            id: 'user-direct',
            name: 'Direct User',
            license: 'business',
            costCenterId: 'cc-engineering',
            individualULB: null
        },
        {
            id: 'user-unassigned',
            name: 'Unassigned User',
            license: 'business',
            individualULB: null
        }
    ];

    return createState({
        enterprise: {
            name: 'Example Enterprise',
            businessSeats: users.length,
            universalULB: 2000,
            enterpriseBudget: 50,
            enterpriseHardStop: false,
            meteredEnabled: true
        },
        teams: [{ id: 'team-platform', name: 'Platform Team' }],
        orgs: [{
            id: 'org-product',
            name: 'Product Org',
            budget: 30,
            budgetHardStop: false
        }],
        costCenters: [{
            id: 'cc-engineering',
            name: 'Engineering CC',
            teamIds: ['team-platform'],
            orgIds: ['org-product'],
            userIds: ['user-direct'],
            poolEnabled: true,
            overagesAllowed: false,
            budget: 20,
            budgetHardStop: true,
            ulb: 1200
        }],
        users,
        usage: Object.fromEntries(users.map((user, index) => [user.id, index === 0 ? 100 : 10])),
        usageBaseline: {}
    });
}

async function openOrgMap(page) {
    const simulator = new SimulatorPage(page);
    await simulator.load(orgMapState());
    await page.getByRole('button', { name: /Org Map/ }).click();
    await expect(page.locator('#panel-orgmap')).toBeVisible();
    return page.locator('#orgMapCanvas');
}

test('navigates to the Org Map and renders each routed user once in its hierarchy', async ({ page }) => {
    const canvas = await openOrgMap(page);
    const enterprise = canvas.locator('[data-orgmap-type="enterprise"]');
    const engineering = enterprise.locator(
        ':scope > .orgmap-cost-centers > [data-orgmap-type="cost-center"][data-orgmap-id="cc-engineering"]'
    );

    await expect(enterprise).toHaveAttribute('aria-label', 'Enterprise Example Enterprise');
    await expect(engineering.locator(':scope > .orgmap-cost-center-header')).toContainText('Engineering CC');
    await expect(engineering.locator('.orgmap-group-team[data-orgmap-id="team-platform"]'))
        .toContainText('Platform Team');
    await expect(engineering.locator('.orgmap-group-organization[data-orgmap-id="org-product"]'))
        .toContainText('Product Org');
    await expect(engineering.locator('.orgmap-group-direct[data-orgmap-id="direct"]'))
        .toContainText('Direct users');

    const team = engineering.locator('.orgmap-group-team[data-orgmap-id="team-platform"]');
    await expect(team.locator(':scope [data-orgmap-type="user"]')).toHaveCount(8);
    const toggle = team.getByRole('button', { name: 'Show 1 more users' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    const expandedToggle = team.getByRole('button', { name: 'Show fewer users' });
    await expect(expandedToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(team.locator(':scope [data-orgmap-type="user"]')).toHaveCount(9);

    const userIds = orgMapState().users.map(user => user.id);
    for (const userId of userIds) {
        await expect(canvas.locator(`[data-orgmap-type="user"][data-orgmap-id="${userId}"]`)).toHaveCount(1);
    }

    const unassigned = enterprise.locator(
        ':scope > .orgmap-cost-centers > [data-orgmap-type="cost-center"][data-orgmap-id="unassigned"]'
    );
    await expect(unassigned).toContainText('Unassigned');
    await expect(unassigned.locator('[data-orgmap-id="user-unassigned"]')).toHaveCount(1);
});

test('shows distinct budget kinds, concurrent overage controls, and ULB precedence', async ({ page }) => {
    const canvas = await openOrgMap(page);
    const enterprise = canvas.locator('[data-orgmap-type="enterprise"]');
    const engineering = canvas.locator('[data-orgmap-type="cost-center"][data-orgmap-id="cc-engineering"]');
    const product = engineering.locator('.orgmap-group-organization[data-orgmap-id="org-product"]');
    const user = engineering.locator('[data-orgmap-type="user"][data-orgmap-id="user-platform-1"]');

    await expect(enterprise.locator(':scope > .orgmap-budgets [data-budget-kind="ulb"]')).toHaveCount(1);
    await expect(enterprise.locator(':scope > .orgmap-budgets [data-budget-kind="overage"]')).toHaveCount(1);
    await expect(engineering.locator(':scope > .orgmap-budgets [data-budget-kind="pool"]'))
        .toHaveClass(/orgmap-budget-effective/);

    await expect(product.locator(':scope > .orgmap-budgets [data-budget-kind="overage"]')).toHaveCount(3);
    await expect(product.locator(':scope > .orgmap-budgets .orgmap-budget-overage.orgmap-budget-effective'))
        .toHaveCount(3);
    await expect(product.locator(':scope > .orgmap-budgets .orgmap-budget-overage.orgmap-budget-shadowed'))
        .toHaveCount(0);

    const inheritedULBs = user.locator(
        ':scope > .orgmap-budgets .orgmap-budget-ulb.orgmap-budget-inherited'
    );
    await expect(inheritedULBs).toHaveCount(2);
    await expect(inheritedULBs.getByRole('button', { name: /Universal ULB:.*shadowed, inherited/ }))
        .toBeVisible();
    await expect(inheritedULBs.getByRole('button', { name: /Engineering CC ULB:.*shadowed, inherited/ }))
        .toBeVisible();
    await expect(user.locator(
        ':scope > .orgmap-budgets .orgmap-budget-ulb.orgmap-budget-effective:not(.orgmap-budget-inherited)'
    )).toContainText('900 AI credits');
});

test('budget info button opens an accessible live-details dialog that Escape closes', async ({ page }) => {
    const canvas = await openOrgMap(page);
    const user = canvas.locator('[data-orgmap-type="user"][data-orgmap-id="user-platform-1"]');
    const individualULB = user.locator(
        ':scope > .orgmap-budgets .orgmap-budget-ulb.orgmap-budget-effective:not(.orgmap-budget-inherited)'
    );
    const info = individualULB.getByRole('button', { name: /Budget details for Platform User 1 individual ULB/ });

    await info.click();
    const dialog = page.getByRole('dialog', { name: 'Platform User 1 individual ULB' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toContainText('Why it applies');
    await expect(dialog).toContainText('individual ULB has the highest precedence');
    const detail = label => dialog.locator('dt', { hasText: new RegExp(`^${label}$`) })
        .locator('xpath=following-sibling::dd[1]');
    await expect(detail('Configured amount')).toHaveText('$9.00 (900 AI credits)');
    await expect(detail('Enforcement')).toContainText('Hard stop');
    await expect(detail('Consumed')).toHaveText('100 AI credits');
    await expect(detail('Remaining')).toHaveText('800 AI credits');
    await expect(detail('Used')).toHaveText('11.1%');
    await expect(dialog.getByRole('button', { name: 'Close budget details' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close budget details' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(info).toBeFocused();
});
