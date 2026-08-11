import { expect } from '@playwright/test';

export class SimulatorPage {
    constructor(page) {
        this.page = page;
    }

    async load(state) {
        await this.page.addInitScript(initialState => {
            if (sessionStorage.getItem('simulator-fixture-loaded')) return;
            localStorage.setItem('budget-simulator-state', JSON.stringify(initialState));
            sessionStorage.setItem('simulator-fixture-loaded', 'true');
        }, structuredClone(state));
        await this.page.goto('/index.html');
        await this.page.waitForLoadState('networkidle');
        await expect(this.page.locator('#dashboardContent')).toBeVisible();
    }

    async loadEmpty() {
        await this.page.goto('/index.html');
        await this.page.waitForLoadState('networkidle');
    }

    row(userId) {
        return this.page.locator(`[data-user-id="${userId}"]`);
    }

    async setUsage(userId, credits) {
        const input = this.row(userId).locator('[data-role="number"]');
        await input.evaluate((element, value) => {
            element.value = String(value);
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }, credits);
    }

    async status(userId) {
        return (await this.row(userId).locator('[data-role="status-last"] .badge').innerText()).trim().toLowerCase();
    }

    async nextStatus(userId) {
        return (await this.row(userId).locator('[data-role="status-next"] .badge').innerText()).trim().toLowerCase();
    }

    async nextReason(userId) {
        return (await this.row(userId).locator('[data-role="next-reason"]').innerText()).trim();
    }

    async details(userId) {
        return (await this.row(userId).locator('[data-role="last-details"]').innerText()).trim();
    }

    async ulbTotal(userId) {
        return (await this.row(userId).locator('[data-role="ulb-total"]').innerText()).trim();
    }

    async usageValue(userId) {
        return Number(await this.row(userId).locator('[data-role="number"]').inputValue());
    }

    async costCenter(userId) {
        return (await this.row(userId).locator('[data-role="cost-center"]').innerText()).trim();
    }

    async summary(key) {
        return (await this.page.locator(`[data-summary="${key}"] .stat-value`).innerText()).trim();
    }

    gauge(key) {
        return this.page.locator(`[data-gauge-key="${key}"]`);
    }

    async gaugeValues(key) {
        const gauge = this.gauge(key);
        return {
            used: (await gauge.locator('[data-role="used"]').innerText()).trim(),
            total: (await gauge.locator('[data-role="total"]').innerText()).trim(),
            percent: (await gauge.locator('[data-role="percent"]').innerText()).trim()
        };
    }

    async setGlobalPercent(key, percent) {
        const input = this.page.locator(`input[type="number"][data-budget-key="${key}"]`);
        await input.evaluate((element, value) => {
            element.value = String(value);
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }, percent);
    }

    async setStartingPoint() {
        await this.page.getByRole('button', { name: /Set as Starting Point/ }).click();
    }

    async resetUsage() {
        await this.page.getByRole('button', { name: 'Reset Usage' }).click();
    }

    async togglePool(costCenterId, enabled) {
        const input = this.page.locator(`[data-cc-id="${costCenterId}"] [data-role="pool-toggle"]`);
        if (enabled) await input.check();
        else await input.uncheck();
    }

    async switchUnit(unit) {
        await this.page.locator('#simulationUnitMode').selectOption(unit);
    }

    async persistedState() {
        return this.page.evaluate(() => JSON.parse(localStorage.getItem('budget-simulator-state')));
    }

    async expectStatus(userId, status, detailsPattern) {
        await expect(this.row(userId).locator('[data-role="status-last"] .badge')).toHaveText(
            new RegExp(`^${status}$`, 'i')
        );
        if (detailsPattern) {
            await expect(this.row(userId).locator('[data-role="last-details"]')).toHaveText(detailsPattern);
        }
    }

    async expectNextStatus(userId, status, reasonPattern) {
        await expect(this.row(userId).locator('[data-role="status-next"] .badge')).toHaveText(
            new RegExp(`^${status}$`, 'i')
        );
        if (reasonPattern) {
            await expect(this.row(userId).locator('[data-role="next-reason"]')).toHaveText(reasonPattern);
        }
    }
}
