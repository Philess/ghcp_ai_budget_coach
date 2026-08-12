export const BUSINESS_CREDITS = 1900;
export const ENTERPRISE_CREDITS = 3900;

export function createState(overrides = {}) {
    const state = {
        enterprise: {
            businessSeats: 0,
            enterpriseSeats: 0,
            meteredEnabled: true,
            enterpriseBudget: 1000,
            enterpriseHardStop: true,
            universalULB: null,
            autoSeats: false
        },
        teams: [],
        orgs: [],
        costCenters: [],
        users: [],
        usage: {},
        usageBaseline: {},
        usageSequence: [],
        simulationUnit: 'credits',
        globalBudgetPercents: {}
    };

    return structuredClone({
        ...state,
        ...overrides,
        enterprise: { ...state.enterprise, ...(overrides.enterprise || {}) }
    });
}

export function singleUserState({
    usage = 0,
    baseline = 0,
    license = 'business',
    meteredEnabled = true,
    enterpriseBudget = 1000,
    enterpriseHardStop = true,
    universalULB = null,
    orgBudget = null,
    orgHardStop = true,
    ccBudget = null,
    ccHardStop = true,
    ccPoolEnabled = false,
    overagesAllowed = true,
    individualULB = null,
    ccULB = null
} = {}) {
    const user = {
        id: 'user-alice',
        name: 'Alice',
        license,
        individualULB,
        costCenterId: ccBudget !== null || ccPoolEnabled || ccULB !== null || !overagesAllowed
            ? 'cc-engineering'
            : null,
        orgId: orgBudget !== null ? 'org-acme' : null,
        teamId: null
    };
    const includeOrg = orgBudget !== null;
    const includeCC = user.costCenterId !== null;

    return createState({
        enterprise: {
            businessSeats: license === 'business' ? 1 : 0,
            enterpriseSeats: license === 'enterprise' ? 1 : 0,
            meteredEnabled,
            enterpriseBudget,
            enterpriseHardStop,
            universalULB
        },
        orgs: includeOrg
            ? [{ id: 'org-acme', name: 'Acme', budget: orgBudget, budgetHardStop: orgHardStop }]
            : [],
        costCenters: includeCC
            ? [{
                id: 'cc-engineering',
                name: 'Engineering',
                teamIds: [],
                orgIds: [],
                userIds: ['user-alice'],
                poolEnabled: ccPoolEnabled,
                overagesAllowed,
                budget: ccBudget,
                budgetHardStop: ccHardStop,
                ulb: ccULB
            }]
            : [],
        users: [user],
        usage: { 'user-alice': usage },
        usageBaseline: baseline > 0 ? { 'user-alice': baseline } : {}
    });
}

export function orderedOverageState() {
    const ids = ['user-philippe', 'user-matthieu', 'user-thierry'];
    return createState({
        enterprise: {
            businessSeats: 3,
            enterpriseSeats: 0,
            meteredEnabled: true,
            enterpriseBudget: 1000,
            enterpriseHardStop: true
        },
        costCenters: [{
            id: 'cc-rnd',
            name: 'RND',
            teamIds: [],
            orgIds: [],
            userIds: ids,
            poolEnabled: false,
            overagesAllowed: true,
            budget: 1,
            budgetHardStop: true,
            ulb: null
        }],
        users: [
            { id: ids[0], name: 'Philippe', license: 'business', individualULB: null },
            { id: ids[1], name: 'Matthieu', license: 'business', individualULB: null },
            { id: ids[2], name: 'Thierry', license: 'business', individualULB: null }
        ],
        usage: Object.fromEntries(ids.map(id => [id, BUSINESS_CREDITS])),
        usageBaseline: Object.fromEntries(ids.map(id => [id, BUSINESS_CREDITS]))
    });
}

export function mixedLicenseState() {
    return createState({
        enterprise: {
            businessSeats: 1,
            enterpriseSeats: 1,
            meteredEnabled: true,
            enterpriseBudget: 100,
            enterpriseHardStop: true,
            autoSeats: true
        },
        users: [
            { id: 'user-business', name: 'Business User', license: 'business', individualULB: null },
            { id: 'user-enterprise', name: 'Enterprise User', license: 'enterprise', individualULB: null }
        ],
        usage: { 'user-business': 100, 'user-enterprise': 100 }
    });
}

export function membershipState() {
    return createState({
        enterprise: {
            businessSeats: 5,
            meteredEnabled: true,
            enterpriseBudget: 100,
            enterpriseHardStop: true
        },
        teams: [{ id: 'team-platform', name: 'Platform' }],
        orgs: [{ id: 'org-sales', name: 'Sales', budget: null, budgetHardStop: true }],
        costCenters: [
            {
                id: 'cc-direct', name: 'Direct CC', teamIds: [], orgIds: [], userIds: [],
                poolEnabled: true, overagesAllowed: true, budget: null, budgetHardStop: true, ulb: null
            },
            {
                id: 'cc-team', name: 'Team CC', teamIds: ['team-platform'], orgIds: [], userIds: [],
                poolEnabled: true, overagesAllowed: true, budget: null, budgetHardStop: true, ulb: null
            },
            {
                id: 'cc-org', name: 'Org CC', teamIds: [], orgIds: ['org-sales'], userIds: [],
                poolEnabled: true, overagesAllowed: true, budget: null, budgetHardStop: true, ulb: null
            },
            {
                id: 'cc-list', name: 'List CC', teamIds: [], orgIds: [], userIds: ['user-list'],
                poolEnabled: true, overagesAllowed: true, budget: null, budgetHardStop: true, ulb: null
            }
        ],
        users: [
            {
                id: 'user-direct', name: 'Direct User', license: 'business',
                costCenterId: 'cc-direct', teamId: null, orgId: null, individualULB: null
            },
            {
                id: 'user-team', name: 'Team User', license: 'business',
                costCenterId: null, teamId: 'team-platform', orgId: null, individualULB: null
            },
            {
                id: 'user-org', name: 'Org User', license: 'business',
                costCenterId: null, teamId: null, orgId: 'org-sales', individualULB: null
            },
            {
                id: 'user-list', name: 'List User', license: 'business',
                costCenterId: null, teamId: null, orgId: null, individualULB: null
            },
            {
                id: 'user-unassigned', name: 'Unassigned User', license: 'business',
                costCenterId: null, teamId: null, orgId: null, individualULB: null
            }
        ],
        usage: {
            'user-direct': 100,
            'user-team': 100,
            'user-org': 100,
            'user-list': 100,
            'user-unassigned': 100
        }
    });
}

export function independentCostCenterBudgetState() {
    return createState({
        enterprise: {
            businessSeats: 4,
            meteredEnabled: true,
            enterpriseBudget: 100,
            enterpriseHardStop: true,
            costCenterBudgetsIndependent: false
        },
        costCenters: [{
            id: 'cc-rnd',
            name: 'RND',
            teamIds: [],
            orgIds: [],
            userIds: ['user-rnd-1', 'user-rnd-2'],
            poolEnabled: true,
            overagesAllowed: true,
            budget: 50,
            budgetHardStop: true,
            ulb: null
        }],
        users: [
            { id: 'user-rnd-1', name: 'RND One', license: 'business', individualULB: null },
            { id: 'user-rnd-2', name: 'RND Two', license: 'business', individualULB: null },
            { id: 'user-shared-1', name: 'Shared One', license: 'business', individualULB: null },
            { id: 'user-shared-2', name: 'Shared Two', license: 'business', individualULB: null }
        ],
        usage: {
            'user-rnd-1': 0,
            'user-rnd-2': 0,
            'user-shared-1': 0,
            'user-shared-2': 0
        }
    });
}

export function multiScopeState() {
    return createState({
        enterprise: {
            businessSeats: 3,
            enterpriseSeats: 0,
            meteredEnabled: true,
            enterpriseBudget: 5,
            enterpriseHardStop: true
        },
        orgs: [
            { id: 'org-engineering', name: 'Engineering Org', budget: 2, budgetHardStop: true },
            { id: 'org-marketing', name: 'Marketing Org', budget: 5, budgetHardStop: true }
        ],
        costCenters: [
            {
                id: 'cc-engineering', name: 'Engineering CC', teamIds: [], orgIds: ['org-engineering'],
                userIds: [], poolEnabled: false, overagesAllowed: true, budget: 1,
                budgetHardStop: true, ulb: null
            },
            {
                id: 'cc-marketing', name: 'Marketing CC', teamIds: [], orgIds: ['org-marketing'],
                userIds: [], poolEnabled: false, overagesAllowed: true, budget: 5,
                budgetHardStop: true, ulb: null
            }
        ],
        users: [
            {
                id: 'user-engineering', name: 'Engineer', license: 'business',
                costCenterId: null, orgId: 'org-engineering', teamId: null, individualULB: null
            },
            {
                id: 'user-marketing', name: 'Marketer', license: 'business',
                costCenterId: null, orgId: 'org-marketing', teamId: null, individualULB: null
            },
            {
                id: 'user-unassigned', name: 'Unassigned', license: 'business',
                costCenterId: null, orgId: null, teamId: null, individualULB: null
            }
        ],
        usage: {
            'user-engineering': BUSINESS_CREDITS,
            'user-marketing': BUSINESS_CREDITS,
            'user-unassigned': BUSINESS_CREDITS
        },
        usageBaseline: {
            'user-engineering': BUSINESS_CREDITS,
            'user-marketing': BUSINESS_CREDITS,
            'user-unassigned': BUSINESS_CREDITS
        }
    });
}
