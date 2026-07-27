// Unit tests for the simulation calculation rules, focusing on the order in which
// per-user consumption changes are applied on top of the saved starting point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSimulator } from './load-simulator.mjs';

const PHILIPPE = 'u-philippe';
const MATTHIEU = 'u-matthieu';
const THIERRY = 'u-thierry';

// 3 business seats → 9,000 pool credits; the RND cost center has a $1 overage
// budget (100 metered credits) with a hard stop and no reserved pool.
function scenarioState() {
    return {
        enterprise: {
            businessSeats: 3,
            enterpriseSeats: 0,
            meteredEnabled: true,
            enterpriseBudget: 1000,
            enterpriseHardStop: true,
            universalULB: null
        },
        teams: [],
        orgs: [],
        costCenters: [{
            id: 'cc-rnd',
            name: 'RND',
            poolEnabled: false,
            overagesAllowed: true,
            budget: 1,
            budgetHardStop: true,
            ulb: null,
            userIds: [PHILIPPE, MATTHIEU, THIERRY]
        }],
        users: [
            { id: PHILIPPE, name: 'Philippe', license: 'business', individualULB: null },
            { id: MATTHIEU, name: 'Matthieu', license: 'business', individualULB: null },
            { id: THIERRY, name: 'Thierry', license: 'business', individualULB: null }
        ],
        usage: {},
        usageBaseline: {},
        usageSequence: [],
        simulationUnit: 'credits',
        globalBudgetPercents: {}
    };
}

// Every user starts at 3,000 credits, which exactly drains the enterprise pool,
// so any further consumption goes to the RND overage budget.
function setupAtStartingPoint() {
    const sim = loadSimulator();
    sim.setState(scenarioState());
    const state = sim.getState();
    state.users.forEach(u => { state.usage[u.id] = 3000; });
    sim.call('setStartingPoint');
    return sim;
}

// Arrays/objects created inside the sandbox belong to another realm, so copy them
// before comparing them with assert's strict deep equality.
function sequenceOf(sim) {
    return [...(sim.getState().usageSequence || [])];
}

function resultsById(sim) {
    const { results } = sim.call('computeSimulationResults');
    return Object.fromEntries(results.map(r => [r.userId, r]));
}

test('the starting point is consumed concurrently by every user', () => {
    const sim = setupAtStartingPoint();
    const byId = resultsById(sim);
    [PHILIPPE, MATTHIEU, THIERRY].forEach(id => {
        assert.equal(byId[id].status, 'served');
        assert.equal(byId[id].creditsFromEntPool, 3000);
        assert.equal(byId[id].creditsMetered, 0);
    });
});

test('changes are applied in the order they were made, not in user list order', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 3060);   // 60 metered → $0.60
    sim.call('applyUserUsageChange', MATTHIEU, 3040);  // 40 metered → $1.00 (budget full)
    sim.call('applyUserUsageChange', PHILIPPE, 3010);  // nothing left → all blocked

    // When the CC budget is exhausted, ALL users in that CC are blocked
    const byId = resultsById(sim);
    assert.equal(byId[THIERRY].status, 'blocked');
    assert.match(byId[THIERRY].reason, /CC budget exhausted/);
    assert.equal(byId[MATTHIEU].status, 'blocked');
    assert.match(byId[MATTHIEU].reason, /CC budget exhausted/);
    assert.equal(byId[PHILIPPE].status, 'blocked');
    assert.match(byId[PHILIPPE].reason, /CC budget exhausted/);
});

test('the reverse change order blocks all users when budget exhausted', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', PHILIPPE, 3060);
    sim.call('applyUserUsageChange', MATTHIEU, 3040);
    sim.call('applyUserUsageChange', THIERRY, 3010);

    // When the CC budget is exhausted, ALL users in that CC are blocked
    const byId = resultsById(sim);
    assert.equal(byId[PHILIPPE].status, 'blocked');
    assert.equal(byId[MATTHIEU].status, 'blocked');
    assert.equal(byId[THIERRY].status, 'blocked');
});

test('re-editing a user records a new step and moves them to the most recent position', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 3060);
    sim.call('applyUserUsageChange', MATTHIEU, 3100);
    sim.call('applyUserUsageChange', THIERRY, 3060); // re-edit: a brand new step

    // Every change is kept as a distinct step, in the order they were made.
    assert.deepEqual(sequenceOf(sim), [THIERRY, MATTHIEU, THIERRY]);

    // Matthieu exhausts the budget, so all users in the CC are blocked
    const byId = resultsById(sim);
    assert.equal(byId[MATTHIEU].status, 'blocked');
    assert.match(byId[MATTHIEU].reason, /CC budget exhausted/);
    assert.equal(byId[THIERRY].status, 'blocked');
    assert.match(byId[THIERRY].reason, /CC budget exhausted/);
});

test('going 50 to 100 to 80 on one user records three distinct steps', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 3050);
    sim.call('applyUserUsageChange', THIERRY, 3100);
    sim.call('applyUserUsageChange', THIERRY, 3080);
    assert.deepEqual(sequenceOf(sim), [THIERRY, THIERRY, THIERRY]);
});

test('results are reported in user list order whatever the change order', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 3010);
    sim.call('applyUserUsageChange', PHILIPPE, 3010);

    const { results } = sim.call('computeSimulationResults');
    assert.deepEqual([...results].map(r => r.userId), [PHILIPPE, MATTHIEU, THIERRY]);
});

test('users that were never edited are applied after the recorded sequence', () => {
    const sim = setupAtStartingPoint();
    const state = sim.getState();
    // Simulate usage restored from an import: above baseline but never recorded.
    state.usage[PHILIPPE] = 3060;
    sim.call('applyUserUsageChange', THIERRY, 3060);

    assert.deepEqual(sequenceOf(sim), [THIERRY]);
    // Both users consume metered credits, exhausting the budget, so both are blocked
    const byId = resultsById(sim);
    assert.equal(byId[THIERRY].status, 'blocked');
    assert.equal(byId[PHILIPPE].status, 'blocked');
});

test('setting a new starting point clears the change sequence', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 3060);
    assert.deepEqual(sequenceOf(sim), [THIERRY]);

    sim.call('setStartingPoint');
    assert.deepEqual(sequenceOf(sim), []);
});

test('a global usage distribution clears the change sequence', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 3060);
    sim.call('applyAllGlobalBudgetPercents');
    assert.deepEqual(sequenceOf(sim), []);
});

test('resetting usage clears the change sequence', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 3060);
    sim.call('resetUsage');
    const state = sim.getState();
    assert.deepEqual([...state.usageSequence], []);
    assert.deepEqual({ ...state.usage }, {});
    assert.deepEqual({ ...state.usageBaseline }, {});
});

test('deleting a user removes them from the change sequence', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 3060);
    sim.call('applyUserUsageChange', MATTHIEU, 3010);
    sim.call('deleteUser', THIERRY);

    const state = sim.getState();
    assert.deepEqual([...state.usageSequence], [MATTHIEU]);
    assert.equal(state.usage[THIERRY], undefined);
    assert.equal(state.usageBaseline[THIERRY], undefined);
});

test('a stale sequence entry for an unknown user is ignored', () => {
    const sim = setupAtStartingPoint();
    const state = sim.getState();
    state.usageSequence = ['u-gone', THIERRY];
    sim.call('applyUserUsageChange', THIERRY, 3060);
    sim.call('applyUserUsageChange', MATTHIEU, 3050);

    const byId = resultsById(sim);
    assert.equal(byId[THIERRY].creditsMetered, 60);
    assert.equal(byId[MATTHIEU].creditsMetered, 40);
});

test('normalizeState keeps a valid sequence and drops invalid entries', () => {
    const sim = loadSimulator();
    const normalized = sim.call('normalizeState', { usageSequence: [THIERRY, 42, null, MATTHIEU] });
    assert.deepEqual([...normalized.usageSequence], [THIERRY, MATTHIEU]);

    const withoutSequence = sim.call('normalizeState', {});
    assert.deepEqual([...withoutSequence.usageSequence], []);
});

test('user-level budgets still block regardless of the change order', () => {
    const sim = setupAtStartingPoint();
    const state = sim.getState();
    state.users.find(u => u.id === MATTHIEU).individualULB = 30;
    sim.call('applyUserUsageChange', MATTHIEU, 3040);

    const byId = resultsById(sim);
    assert.equal(byId[MATTHIEU].status, 'blocked');
    assert.match(byId[MATTHIEU].reason, /ULB exceeded/);
});

test('exhausting the cost center budget blocks members still served from the pool', () => {
    const sim = setupAtStartingPoint();
    // Philippe never changes: his 3,000 credits are fully served from the pool with
    // zero overage. Matthieu alone drives the RND overage budget over its $1 cap.
    sim.call('applyUserUsageChange', MATTHIEU, 3200); // wants 200 overage, budget only covers 100

    const byId = resultsById(sim);
    // The cost center is over budget, so the whole cost center is frozen — even
    // Philippe and Thierry, who only ever touched the free pool, are blocked.
    assert.equal(byId[MATTHIEU].status, 'blocked');
    assert.match(byId[MATTHIEU].reason, /CC budget exhausted/);
    assert.equal(byId[PHILIPPE].status, 'blocked');
    assert.match(byId[PHILIPPE].reason, /CC budget exhausted/);
    assert.equal(byId[THIERRY].status, 'blocked');
    assert.match(byId[THIERRY].reason, /CC budget exhausted/);
});

test('the cost center stays served when overage fits inside the budget', () => {
    const sim = setupAtStartingPoint();
    // Combined overage of 30 + 40 = 70 credits fits inside the 100-credit ($1) budget,
    // so nobody is shut down and unchanged members remain served from the pool.
    sim.call('applyUserUsageChange', THIERRY, 3030);
    sim.call('applyUserUsageChange', MATTHIEU, 3040);

    const byId = resultsById(sim);
    assert.equal(byId[THIERRY].status, 'metered');
    assert.equal(byId[MATTHIEU].status, 'metered');
    assert.equal(byId[PHILIPPE].status, 'served');
});

// The reserved cost center pool is a shared resource: it is 3 business seats × 3,000
// = 9,000 credits and it has no overage budget, so once it is exhausted every member
// competing for it is blocked — not just the members processed last.
function sharedPoolState() {
    return {
        enterprise: {
            businessSeats: 3, enterpriseSeats: 0, meteredEnabled: true,
            enterpriseBudget: 1000, enterpriseHardStop: true, universalULB: null
        },
        teams: [], orgs: [],
        costCenters: [{
            id: 'cc-rnd', name: 'RND', poolEnabled: true, overagesAllowed: true,
            budget: 0, budgetHardStop: true, ulb: null,
            userIds: [PHILIPPE, MATTHIEU, THIERRY]
        }],
        users: [
            { id: PHILIPPE, name: 'Philippe', license: 'business', individualULB: null },
            { id: MATTHIEU, name: 'Matthieu', license: 'business', individualULB: null },
            { id: THIERRY, name: 'Thierry', license: 'business', individualULB: null }
        ],
        usage: {}, usageBaseline: {}, usageSequence: [],
        simulationUnit: 'credits', globalBudgetPercents: {}
    };
}

test('an exhausted cost center pool blocks every member, whatever the change order', () => {
    const sim = loadSimulator();
    sim.setState(sharedPoolState());
    const state = sim.getState();
    // Baseline uses 8,700 of the 9,000 pool, leaving 300 credits residual.
    state.users.forEach(u => { state.usage[u.id] = 2900; });
    sim.call('setStartingPoint');

    // Each user asks for 200 more (600 total) but only 300 pool credits remain and
    // there is no overage budget, so the group is over-subscribed.
    sim.call('applyUserUsageChange', THIERRY, 3100);
    sim.call('applyUserUsageChange', MATTHIEU, 3100);
    sim.call('applyUserUsageChange', PHILIPPE, 3100);

    const byId = resultsById(sim);
    // The 300 residual credits are shared concurrently (100 each), so nobody is fully
    // served and, with no overage budget, all three are blocked.
    [PHILIPPE, MATTHIEU, THIERRY].forEach(id => {
        assert.equal(byId[id].status, 'blocked', `${id} should be blocked`);
        assert.equal(byId[id].creditsFromCC, 3000, `${id} keeps its fair 100-credit pool share above baseline`);
    });
});
