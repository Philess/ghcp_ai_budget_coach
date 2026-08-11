import { expect, test } from '@playwright/test';
import { membershipState, mixedLicenseState } from './fixtures/scenarios.js';
import { SimulatorPage } from './pages/simulator-page.js';

test('loads separated stylesheet and application assets without browser errors', async ({ page }) => {
    const errors = [];
    const failedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => failedRequests.push(request.url()));

    const simulator = new SimulatorPage(page);
    await simulator.loadEmpty();

    await expect(page.locator('h1')).toContainText('AI Credit Budget Simulator');
    await expect(page.locator('#dashboardEmpty')).toBeVisible();
    expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily))
        .toContain('Segoe UI');
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
});

test('creates and persists a mixed-license enterprise through the setup wizard', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.loadEmpty();
    await page.getByRole('button', { name: /Setup Wizard/ }).click();

    await page.locator('#wizardOrgName').fill('Acme');
    await page.locator('#wizardOrgName').press('Enter');
    await expect(page.locator('#wizardOrgList')).toContainText('Acme');
    await page.getByRole('button', { name: /Next/ }).click();

    await page.locator('#wizardTeamName').fill('Platform');
    await page.locator('#wizardTeamName').press('Enter');
    await expect(page.locator('#wizardTeamList')).toContainText('Platform');
    await page.getByRole('button', { name: /Next/ }).click();

    await page.locator('#wizardCCName').fill('Engineering');
    await page.locator('#wizardCCTeams label', { hasText: 'Platform' }).click();
    await page.locator('#wizardCCOrgs label', { hasText: 'Acme' }).click();
    await page.getByRole('button', { name: '+ Add Cost Center', exact: true }).click();
    await expect(page.locator('#wizardCCList')).toContainText('Engineering');
    await page.getByRole('button', { name: /Next/ }).click();

    await page.locator('#wizardUserName').fill('Alice');
    await page.locator('#wizardUserLicense').selectOption('business');
    await page.locator('#wizardUserCC').selectOption({ label: 'Engineering' });
    await page.locator('#wizardUserOrg').selectOption({ label: 'Acme' });
    await page.locator('#wizardUserTeam').selectOption({ label: 'Platform' });
    await page.getByRole('button', { name: '+ Add User', exact: true }).click();

    await page.locator('#wizardUserName').fill('Bob');
    await page.locator('#wizardUserLicense').selectOption('enterprise');
    await page.locator('#wizardUserCC').selectOption({ label: 'Engineering' });
    await page.locator('#wizardUserOrg').selectOption({ label: 'Acme' });
    await page.locator('#wizardUserTeam').selectOption({ label: 'Platform' });
    await page.getByRole('button', { name: '+ Add User', exact: true }).click();
    await expect(page.locator('#wizardUserList')).toContainText('2 user(s) added');
    await page.getByRole('button', { name: /Next/ }).click();

    await page.locator('#wizardUniversalULB').fill('25');
    await page.locator('#wizardULBTarget').selectOption({ label: 'Alice' });
    await page.locator('#wizardULBValue').fill('10');
    await page.locator('#wizardULBValue').press('Enter');
    await page.locator('#wizardULBType').selectOption('costcenter');
    await page.locator('#wizardULBTarget').selectOption({ label: 'Engineering' });
    await page.locator('#wizardULBValue').fill('20');
    await page.locator('#wizardULBValue').press('Enter');
    await page.getByRole('button', { name: /Next/ }).click();

    await page.locator('#wizardEntBudget').fill('100');
    await page.locator('#wizardOverageTarget').selectOption({ label: 'Acme' });
    await page.locator('#wizardOverageValue').fill('100');
    await page.locator('#wizardOverageValue').locator('xpath=ancestor::form')
        .getByRole('button', { name: '+ Add', exact: true }).click();
    await expect(page.locator('#wizardOverageError')).toBeEmpty();
    await expect(page.locator('#wizardOverageList')).toContainText('Acme');
    await page.locator('#wizardOverageType').selectOption('costcenter');
    await page.locator('#wizardOverageTarget').selectOption({ label: 'Engineering' });
    await page.locator('#wizardOverageValue').fill('50');
    await page.locator('#wizardOverageValue').locator('xpath=ancestor::form')
        .getByRole('button', { name: '+ Add', exact: true }).click();
    await expect(page.locator('#wizardOverageList')).toContainText('Engineering');
    await page.getByRole('button', { name: /Next/ }).click();

    await expect(page.locator('#wizardBody')).toContainText('Organizations (1)');
    await expect(page.locator('#wizardBody')).toContainText('Enterprise Teams (1)');
    await expect(page.locator('#wizardBody')).toContainText('Users (2)');
    await page.getByRole('button', { name: /Confirm & Create/ }).click();
    await expect(page.locator('#wizardBody')).toContainText('Setup Complete');
    await page.getByRole('button', { name: /Close/ }).click();

    await page.getByRole('button', { name: /Settings/ }).click();
    await page.locator('#autoSeats').check();
    await expect(page.locator('[data-enterprise-stat="total-pool"] .stat-value')).toHaveText('5,800');
    await expect(page.locator('[data-enterprise-stat="business-seats"] .stat-value')).toHaveText('1');
    await expect(page.locator('[data-enterprise-stat="enterprise-seats"] .stat-value')).toHaveText('1');

    await page.getByRole('button', { name: /Dashboard/ }).click();
    const state = await simulator.persistedState();
    const engineering = state.costCenters.find(costCenter => costCenter.name === 'Engineering');
    await simulator.togglePool(engineering.id, true);
    await expect(page.locator(`[data-cc-id="${engineering.id}"]`)).toContainText('5,800 credits');

    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloaded = await simulator.persistedState();
    expect(reloaded.enterprise.businessSeats).toBe(1);
    expect(reloaded.enterprise.enterpriseSeats).toBe(1);
    expect(reloaded.enterprise.universalULB).toBe(2500);
    expect(reloaded.users.find(user => user.name === 'Alice').individualULB).toBe(1000);
    expect(reloaded.costCenters.find(costCenter => costCenter.name === 'Engineering')).toMatchObject({
        poolEnabled: true,
        budget: 50,
        ulb: 2000
    });
    expect(reloaded.orgs.find(org => org.name === 'Acme').budget).toBe(100);
});

test('resolves direct, team, organization, direct-list, and unassigned membership', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(membershipState());

    const expected = {
        'user-direct': 'Direct CC',
        'user-team': 'Team CC',
        'user-org': 'Org CC',
        'user-list': 'List CC',
        'user-unassigned': '—'
    };
    for (const [userId, costCenter] of Object.entries(expected)) {
        expect(await simulator.costCenter(userId)).toBe(costCenter);
        await simulator.expectStatus(userId, 'served');
    }
    await expect(simulator.gauge('enterprise-pool')).toContainText('1,900 AI credits');
});

test('auto-seat mixed-license state derives a 5,800-credit pool', async ({ page }) => {
    const simulator = new SimulatorPage(page);
    await simulator.load(mixedLicenseState());
    await page.getByRole('button', { name: /Settings/ }).click();

    await expect(page.locator('[data-enterprise-stat="total-pool"] .stat-value')).toHaveText('5,800');
    await expect(page.locator('#businessSeats')).toHaveValue('1');
    await expect(page.locator('#enterpriseSeats')).toHaveValue('1');
});
