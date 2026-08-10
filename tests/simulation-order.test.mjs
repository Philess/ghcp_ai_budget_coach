// Unit tests for the simulation calculation rules, focusing on the order in which
// per-user consumption changes are applied on top of the saved starting point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSimulator } from './load-simulator.mjs';

const PHILIPPE = 'u-philippe';
const MATTHIEU = 'u-matthieu';
const THIERRY = 'u-thierry';

// 3 business seats → 5,700 pool credits; the RND cost center has a $1 overage
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

// Every user starts at 1,900 credits, which exactly drains the enterprise pool,
// so any further consumption goes to the RND overage budget.
function setupAtStartingPoint() {
    const sim = loadSimulator();
    sim.setState(scenarioState());
    const state = sim.getState();
    state.users.forEach(u => { state.usage[u.id] = 1900; });
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

function assertLastCall(result, status, reason) {
    assert.equal(result.lastCallStatus, status);
    if (reason) assert.match(result.lastCallReason, reason);
}

function assertNextCall(result, status, reason) {
    assert.equal(result.nextCallStatus, status);
    if (reason) assert.match(result.nextCallReason, reason);
}

test('the starting point is consumed concurrently by every user', () => {
    const sim = setupAtStartingPoint();
    const byId = resultsById(sim);
    [PHILIPPE, MATTHIEU, THIERRY].forEach(id => {
        assertLastCall(byId[id], 'served');
        assertNextCall(byId[id], 'metered');
        assert.equal(byId[id].creditsFromEntPool, 1900);
        assert.equal(byId[id].creditsMetered, 0);
    });
});

test('SEQ-04 preserves successful calls before the cost-center freeze', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 1960);   // 60 metered → $0.60
    sim.call('applyUserUsageChange', MATTHIEU, 1940);  // 40 metered → $1.00 (budget full)
    sim.call('applyUserUsageChange', PHILIPPE, 1910);  // nothing left → all blocked

    const byId = resultsById(sim);
    assertLastCall(byId[THIERRY], 'metered');
    assertLastCall(byId[MATTHIEU], 'metered');
    assertLastCall(byId[PHILIPPE], 'blocked', /CC budget exhausted/);
    [THIERRY, MATTHIEU, PHILIPPE].forEach(id => {
        assertNextCall(byId[id], 'blocked', /CC budget exhausted/);
    });
});

test('reverse ordering preserves historical outcomes and the same next-call freeze', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', PHILIPPE, 1960);
    sim.call('applyUserUsageChange', MATTHIEU, 1940);
    sim.call('applyUserUsageChange', THIERRY, 1910);

    const byId = resultsById(sim);
    assertLastCall(byId[PHILIPPE], 'metered');
    assertLastCall(byId[MATTHIEU], 'metered');
    assertLastCall(byId[THIERRY], 'blocked', /CC budget exhausted/);
    [PHILIPPE, MATTHIEU, THIERRY].forEach(id => {
        assertNextCall(byId[id], 'blocked', /CC budget exhausted/);
    });
});

test('a later user action does not rewrite another user last-call outcome or breakdown', () => {
    const sim = loadSimulator();
    const state = scenarioState();
    state.enterprise.businessSeats = 1;
    state.costCenters = [];
    state.users = [state.users[0], state.users[1]];
    sim.setState(state);

    sim.call('applyUserUsageChange', PHILIPPE, 2000);
    let byId = resultsById(sim);
    assertLastCall(byId[PHILIPPE], 'metered');
    assert.equal(byId[PHILIPPE].lastCallCreditsFromEntPool, 1900);
    assert.equal(byId[PHILIPPE].lastCallCreditsMetered, 100);

    sim.call('applyUserUsageChange', MATTHIEU, 2000);
    byId = resultsById(sim);
    assertLastCall(byId[PHILIPPE], 'metered');
    assertLastCall(byId[MATTHIEU], 'metered');
    assert.equal(byId[PHILIPPE].lastCallCreditsFromEntPool, 1900);
    assert.equal(byId[PHILIPPE].lastCallCreditsMetered, 100);
    assert.equal(byId[MATTHIEU].lastCallCreditsFromEntPool, 950);
    assert.equal(byId[MATTHIEU].lastCallCreditsMetered, 1050);
});

test('a historical blocked reason follows the selected display unit', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 2001);
    let result = resultsById(sim)[THIERRY];
    assertLastCall(result, 'blocked', /100 AI credits/);

    sim.getState().simulationUnit = 'dollars';
    result = resultsById(sim)[THIERRY];
    assertLastCall(result, 'blocked', /\$1\.00/);
});

test('re-editing a user records a new step and moves them to the most recent position', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 1960);
    sim.call('applyUserUsageChange', MATTHIEU, 2000);
    sim.call('applyUserUsageChange', THIERRY, 1960); // re-edit: a brand new step

    // Every change is kept as a distinct step, in the order they were made.
    assert.deepEqual(sequenceOf(sim), [THIERRY, MATTHIEU, THIERRY]);

    const byId = resultsById(sim);
    assertLastCall(byId[MATTHIEU], 'blocked', /CC budget exhausted/);
    assertLastCall(byId[THIERRY], 'blocked', /CC budget exhausted/);
    [PHILIPPE, MATTHIEU, THIERRY].forEach(id => {
        assertNextCall(byId[id], 'blocked', /CC budget exhausted/);
    });
});

test('going 50 to 100 to 80 on one user records three distinct steps', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 1950);
    sim.call('applyUserUsageChange', THIERRY, 2000);
    sim.call('applyUserUsageChange', THIERRY, 1980);
    assert.deepEqual(sequenceOf(sim), [THIERRY, THIERRY, THIERRY]);
});

test('results are reported in user list order whatever the change order', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 1910);
    sim.call('applyUserUsageChange', PHILIPPE, 1910);

    const { results } = sim.call('computeSimulationResults');
    assert.deepEqual([...results].map(r => r.userId), [PHILIPPE, MATTHIEU, THIERRY]);
});

test('users that were never edited are applied after the recorded sequence', () => {
    const sim = setupAtStartingPoint();
    const state = sim.getState();
    // Simulate usage restored from an import: above baseline but never recorded.
    state.usage[PHILIPPE] = 1960;
    sim.call('applyUserUsageChange', THIERRY, 1960);

    assert.deepEqual(sequenceOf(sim), [THIERRY]);
    const byId = resultsById(sim);
    assertLastCall(byId[THIERRY], 'metered');
    assertNextCall(byId[THIERRY], 'blocked', /CC budget exhausted/);
    assertNextCall(byId[PHILIPPE], 'blocked', /CC budget exhausted/);
});

test('setting a new starting point clears the change sequence', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 1960);
    assert.deepEqual(sequenceOf(sim), [THIERRY]);

    sim.call('setStartingPoint');
    assert.deepEqual(sequenceOf(sim), []);
});

test('a global usage distribution clears the change sequence', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 1960);
    sim.call('applyAllGlobalBudgetPercents');
    assert.deepEqual(sequenceOf(sim), []);
});

test('resetting usage clears the change sequence', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 1960);
    sim.call('resetUsage');
    const state = sim.getState();
    assert.deepEqual([...state.usageSequence], []);
    assert.deepEqual({ ...state.usage }, {});
    assert.deepEqual({ ...state.usageBaseline }, {});
});

test('deleting a user removes them from the change sequence', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', THIERRY, 1960);
    sim.call('applyUserUsageChange', MATTHIEU, 1910);
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
    sim.call('applyUserUsageChange', THIERRY, 1960);
    sim.call('applyUserUsageChange', MATTHIEU, 1950);

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
    sim.call('applyUserUsageChange', MATTHIEU, 1940);

    const byId = resultsById(sim);
    assertLastCall(byId[MATTHIEU], 'blocked', /ULB exceeded/);
    assertNextCall(byId[MATTHIEU], 'blocked', /ULB exceeded/);
});

test('cost-center propagation keeps historical outcomes and freezes only the next call', () => {
    const sim = setupAtStartingPoint();
    sim.call('applyUserUsageChange', MATTHIEU, 2000); // exactly consumes the $1 budget

    const byId = resultsById(sim);
    assertLastCall(byId[MATTHIEU], 'metered');
    assertLastCall(byId[PHILIPPE], 'served');
    assertLastCall(byId[THIERRY], 'served');
    [MATTHIEU, PHILIPPE, THIERRY].forEach(id => {
        assertNextCall(byId[id], 'blocked', /CC budget exhausted/);
    });
});

test('the cost center stays served when overage fits inside the budget', () => {
    const sim = setupAtStartingPoint();
    // Combined overage of 30 + 40 = 70 credits fits inside the 100-credit ($1) budget,
    // so nobody is shut down and unchanged members remain served from the pool.
    sim.call('applyUserUsageChange', THIERRY, 1930);
    sim.call('applyUserUsageChange', MATTHIEU, 1940);

    const byId = resultsById(sim);
    assertLastCall(byId[THIERRY], 'metered');
    assertLastCall(byId[MATTHIEU], 'metered');
    assertLastCall(byId[PHILIPPE], 'served');
    [THIERRY, MATTHIEU, PHILIPPE].forEach(id => assertNextCall(byId[id], 'metered'));
});

test('next call is served while an applicable pool credit remains', () => {
    const sim = loadSimulator();
    const state = scenarioState();
    state.enterprise.businessSeats = 1;
    state.costCenters = [];
    state.users = [state.users[0]];
    state.usage = { [PHILIPPE]: 1899 };
    sim.setState(state);

    const result = resultsById(sim)[PHILIPPE];
    assertLastCall(result, 'served');
    assertNextCall(result, 'served');
});

test('next call is metered when pools are empty and budgets have headroom', () => {
    const sim = loadSimulator();
    const state = scenarioState();
    state.enterprise.businessSeats = 1;
    state.costCenters = [];
    state.users = [state.users[0]];
    state.usage = { [PHILIPPE]: 1900 };
    sim.setState(state);

    const result = resultsById(sim)[PHILIPPE];
    assertLastCall(result, 'served');
    assertNextCall(result, 'metered');
});

test('an exhausted ULB blocks the next call even when budgets have room', () => {
    const sim = loadSimulator();
    const state = scenarioState();
    state.enterprise.businessSeats = 1;
    state.costCenters = [];
    state.users = [{ ...state.users[0], individualULB: 100 }];
    state.usage = { [PHILIPPE]: 100 };
    sim.setState(state);

    const result = resultsById(sim)[PHILIPPE];
    assertLastCall(result, 'served');
    assertNextCall(result, 'blocked', /ULB exceeded/);
});

test('an organization freeze affects only members of that organization', () => {
    const sim = loadSimulator();
    const state = scenarioState();
    state.costCenters = [];
    state.orgs = [{
        id: 'org-acme',
        name: 'Acme',
        budget: 1,
        budgetHardStop: true
    }];
    state.users[0].orgId = 'org-acme';
    state.users[1].orgId = 'org-acme';
    state.usage = {
        [PHILIPPE]: 1900,
        [MATTHIEU]: 1900,
        [THIERRY]: 1900
    };
    sim.setState(state);
    sim.call('setStartingPoint');
    sim.call('applyUserUsageChange', MATTHIEU, 2000);

    const byId = resultsById(sim);
    assertLastCall(byId[PHILIPPE], 'served');
    assertLastCall(byId[MATTHIEU], 'metered');
    assertLastCall(byId[THIERRY], 'served');
    [PHILIPPE, MATTHIEU].forEach(id => {
        assertNextCall(byId[id], 'blocked', /Org budget exhausted/);
    });
    assertNextCall(byId[THIERRY], 'metered');
});

test('a tighter organization stop does not exhaust broader budgets', () => {
    const sim = loadSimulator();
    const state = scenarioState();
    state.enterprise.businessSeats = 1;
    state.enterprise.enterpriseBudget = 2;
    state.costCenters = [{
        id: 'cc-rnd',
        name: 'RND',
        poolEnabled: false,
        overagesAllowed: true,
        budget: 2,
        budgetHardStop: true,
        ulb: null,
        userIds: [PHILIPPE, MATTHIEU]
    }];
    state.orgs = [{
        id: 'org-acme',
        name: 'Acme',
        budget: 1,
        budgetHardStop: true
    }];
    state.users = [
        { ...state.users[0], orgId: 'org-acme' },
        state.users[1]
    ];
    state.usage = { [PHILIPPE]: 1900, [MATTHIEU]: 0 };
    sim.setState(state);
    sim.call('setStartingPoint');
    sim.call('applyUserUsageChange', PHILIPPE, 2200);

    const byId = resultsById(sim);
    assertLastCall(byId[PHILIPPE], 'blocked', /Org budget exhausted/);
    assertNextCall(byId[PHILIPPE], 'blocked', /Org budget exhausted/);
    assertNextCall(byId[MATTHIEU], 'metered');
    const { poolState } = sim.call('computeSimulationResults');
    assert.equal(poolState.orgMetered['org-acme'], 1);
    assert.equal(poolState.ccMetered['cc-rnd'], 1);
    assert.equal(poolState.enterpriseMetered, 1);
});

test('enterprise exhaustion projects pool headroom as served and paid overage as blocked', () => {
    const sim = loadSimulator();
    const state = scenarioState();
    state.enterprise.businessSeats = 2;
    state.enterprise.enterpriseBudget = 1;
    state.costCenters = [{
        id: 'cc-reserved',
        name: 'Reserved',
        poolEnabled: true,
        overagesAllowed: true,
        budget: null,
        budgetHardStop: true,
        ulb: null,
        userIds: [PHILIPPE]
    }];
    state.users = [
        state.users.find(user => user.id === PHILIPPE),
        state.users.find(user => user.id === MATTHIEU)
    ];
    state.usage = {
        [PHILIPPE]: 1000,
        [MATTHIEU]: 2000
    };
    sim.setState(state);

    const byId = resultsById(sim);
    assertLastCall(byId[PHILIPPE], 'served');
    assertLastCall(byId[MATTHIEU], 'metered');
    assertNextCall(byId[PHILIPPE], 'served');
    assertNextCall(byId[MATTHIEU], 'blocked', /Enterprise budget exhausted/);
});

// The reserved cost center pool is a shared resource: it is 3 business seats × 1,900
// = 5,700 credits and it has no overage budget, so once it is exhausted every member
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

test('pool exhaustion preserves earlier calls and blocks every next call', () => {
    const sim = loadSimulator();
    sim.setState(sharedPoolState());
    const state = sim.getState();
    // Baseline uses 5,400 of the 5,700 pool, leaving 300 credits residual.
    state.users.forEach(u => { state.usage[u.id] = 1800; });
    sim.call('setStartingPoint');

    // Each user asks for 200 more (600 total) but only 300 pool credits remain and
    // there is no overage budget, so the group is over-subscribed.
    sim.call('applyUserUsageChange', THIERRY, 2000);
    sim.call('applyUserUsageChange', MATTHIEU, 2000);
    sim.call('applyUserUsageChange', PHILIPPE, 2000);

    const byId = resultsById(sim);
    // Thierry's earlier request fit at the time it was made. Later actions do not
    // rewrite that outcome, while the final fair share leaves every next call blocked.
    assertLastCall(byId[THIERRY], 'served');
    assertLastCall(byId[MATTHIEU], 'blocked');
    assertLastCall(byId[PHILIPPE], 'blocked');
    [PHILIPPE, MATTHIEU, THIERRY].forEach(id => {
        assertNextCall(byId[id], 'blocked');
        assert.equal(byId[id].creditsFromCC, 1900, `${id} keeps its fair 100-credit pool share above baseline`);
    });
});

test('off-promotion seat entitlements provide 1,900 Business and 3,900 Enterprise credits', () => {
    const sim = loadSimulator();
    const state = scenarioState();
    state.enterprise.businessSeats = 1;
    state.enterprise.enterpriseSeats = 1;
    sim.setState(state);

    assert.equal(sim.call('totalPool'), 5800);
    assert.equal(sim.call('userCreditsPerSeat', { license: 'business' }), 1900);
    assert.equal(sim.call('userCreditsPerSeat', { license: 'enterprise' }), 3900);
});

test('cost-center ULB applies to members resolved through an enterprise team', () => {
    const sim = loadSimulator();
    const state = scenarioState();
    state.enterprise.businessSeats = 1;
    state.teams = [{ id: 'team-platform', name: 'Platform' }];
    state.costCenters = [{
        id: 'cc-platform',
        name: 'Platform CC',
        teamIds: ['team-platform'],
        orgIds: [],
        userIds: [],
        poolEnabled: false,
        overagesAllowed: true,
        budget: null,
        budgetHardStop: true,
        ulb: 100
    }];
    state.users = [{
        id: PHILIPPE,
        name: 'Philippe',
        license: 'business',
        teamId: 'team-platform',
        individualULB: null
    }];
    state.usage = { [PHILIPPE]: 101 };
    sim.setState(state);

    const byId = resultsById(sim);
    assertLastCall(byId[PHILIPPE], 'blocked', /ULB exceeded.*CC: Platform CC/);
    assertNextCall(byId[PHILIPPE], 'blocked', /ULB exceeded.*CC: Platform CC/);
});

// The starting point is consumed by everyone at once, so an over-subscribed pool is
// split fairly instead of being handed entirely to the first user in the list.
function baselineSharingState(userOrder) {
    const state = scenarioState();
    state.enterprise.businessSeats = 1;   // 1,900 pool credits for two users
    state.enterprise.enterpriseBudget = null;
    state.enterprise.enterpriseHardStop = false;
    state.costCenters = [];
    state.users = userOrder.map(id => ({
        id,
        name: id,
        license: 'business',
        individualULB: null
    }));
    return state;
}

test('an over-subscribed starting point is shared fairly whatever the user order', () => {
    [[PHILIPPE, MATTHIEU], [MATTHIEU, PHILIPPE]].forEach(order => {
        const sim = loadSimulator();
        sim.setState(baselineSharingState(order));
        const state = sim.getState();
        state.users.forEach(u => { state.usage[u.id] = 1900; });
        sim.call('setStartingPoint');

        const byId = resultsById(sim);
        order.forEach(id => {
            assert.equal(byId[id].creditsFromEntPool, 950, `${id} gets half of the pool`);
            assert.equal(byId[id].creditsMetered, 950, `${id} meters the other half`);
        });
    });
});

test('an over-subscribed starting point blocks nobody in particular when metering is off', () => {
    const state = baselineSharingState([PHILIPPE, MATTHIEU]);
    state.enterprise.meteredEnabled = false;
    const sim = loadSimulator();
    sim.setState(state);
    const simState = sim.getState();
    simState.users.forEach(u => { simState.usage[u.id] = 1900; });
    sim.call('setStartingPoint');

    const byId = resultsById(sim);
    [PHILIPPE, MATTHIEU].forEach(id => {
        assert.equal(byId[id].creditsFromEntPool, 950);
        assertLastCall(byId[id], 'blocked', /metered usage not enabled/);
    });
});
