import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSimulator } from './load-simulator.mjs';

function orgMapState() {
    return {
        enterprise: {
            businessSeats: 2,
            enterpriseSeats: 0,
            meteredEnabled: false,
            enterpriseBudget: null,
            enterpriseHardStop: true,
            universalULB: null
        },
        teams: [{ id: 'team-platform', name: 'Platform Team' }],
        orgs: [{ id: 'org-product', name: 'Product Org', budget: null, budgetHardStop: true }],
        costCenters: [{
            id: 'cc-engineering',
            name: 'Engineering',
            teamIds: ['team-platform'],
            orgIds: ['org-product'],
            poolEnabled: false,
            overagesAllowed: true,
            budget: null,
            budgetHardStop: true,
            ulb: null
        }],
        users: [{
            id: 'user-both',
            name: 'Both Memberships',
            license: 'business',
            teamId: 'team-platform',
            orgId: 'org-product',
            individualULB: null
        }, {
            id: 'user-org',
            name: 'Org Membership',
            license: 'business',
            orgId: 'org-product',
            individualULB: null
        }],
        usage: { 'user-both': 100, 'user-org': 50 },
        usageBaseline: {},
        usageSequence: [],
        simulationUnit: 'credits',
        globalBudgetPercents: {}
    };
}

test('org map aggregates every matching team and organization without rendering duplicate users', () => {
    const sim = loadSimulator();
    sim.setState(orgMapState());

    const model = sim.call('buildOrgMapModel');
    const costCenter = model.costCenters.find(cc => cc.id === 'cc-engineering');
    const team = costCenter.groups.find(group => group.type === 'team' && group.id === 'team-platform');
    const organization = costCenter.groups.find(group =>
        group.type === 'organization' && group.id === 'org-product');

    assert.deepEqual(Array.from(team.users, user => user.id), ['user-both']);
    assert.deepEqual(Array.from(organization.users, user => user.id), ['user-org']);
    assert.equal(organization.memberCount, 2);
    assert.equal(organization.usage, 150);
    assert.equal(costCenter.usage, 150);

    const usage = sim.call('buildOrgMapUsage', model);
    assert.equal(usage.groups['cost-center:cc-engineering/organization:org-product'].capacity.users, 2);
    assert.equal(usage.groups['cost-center:cc-engineering/organization:org-product'].creditsRequested, 150);
    assert.equal(usage.costCenters['cost-center:cc-engineering'].creditsRequested, 150);
});
