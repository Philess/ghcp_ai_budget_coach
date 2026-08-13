// ─── State ───────────────────────────────────────────────────────────────────
let state = loadState() || defaultState();

function defaultState() {
    return {
        enterprise: {
            businessSeats: 0,
            enterpriseSeats: 0,
            meteredEnabled: true,
            enterpriseBudget: 1000,
            enterpriseHardStop: true,
            costCenterBudgetsIndependent: false,
            universalULB: null
        },
        teams: [],
        orgs: [],
        costCenters: [],
        users: [],
        usage: {},
        usageBaseline: {},
        usageSequence: [],
        lastCallOutcomes: {},
        simulationUnit: 'credits',
        globalBudgetPercents: {}
    };
}

const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char]);
}

function escapeInlineArg(value) {
    return escapeHtml(String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
}

function optionHtml(value, label, selected = false) {
    return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function normalizeState(parsed) {
    const defaults = defaultState();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;

    if (parsed.enterprise && parsed.enterprise.licenseType !== undefined) {
        const seats = parsed.enterprise.totalSeats || 0;
        if (parsed.enterprise.licenseType === 'enterprise') {
            parsed.enterprise.enterpriseSeats = seats;
            parsed.enterprise.businessSeats = 0;
        } else {
            parsed.enterprise.businessSeats = seats;
            parsed.enterprise.enterpriseSeats = 0;
        }
        delete parsed.enterprise.licenseType;
        delete parsed.enterprise.totalSeats;
    }

    const enterprise = parsed.enterprise && typeof parsed.enterprise === 'object' && !Array.isArray(parsed.enterprise)
        ? parsed.enterprise
        : {};

    return {
        ...defaults,
        ...parsed,
        enterprise: { ...defaults.enterprise, ...enterprise },
        teams: Array.isArray(parsed.teams) ? parsed.teams : [],
        orgs: Array.isArray(parsed.orgs) ? parsed.orgs : [],
        costCenters: Array.isArray(parsed.costCenters) ? parsed.costCenters : [],
        users: Array.isArray(parsed.users) ? parsed.users : [],
        usage: parsed.usage && typeof parsed.usage === 'object' && !Array.isArray(parsed.usage) ? parsed.usage : {},
        usageBaseline: parsed.usageBaseline && typeof parsed.usageBaseline === 'object' && !Array.isArray(parsed.usageBaseline) ? parsed.usageBaseline : {},
        usageSequence: Array.isArray(parsed.usageSequence) ? [...new Set(parsed.usageSequence.filter(id => typeof id === 'string'))] : [],
        lastCallOutcomes: parsed.lastCallOutcomes && typeof parsed.lastCallOutcomes === 'object' && !Array.isArray(parsed.lastCallOutcomes) ? parsed.lastCallOutcomes : {},
        globalBudgetPercents: parsed.globalBudgetPercents && typeof parsed.globalBudgetPercents === 'object' && !Array.isArray(parsed.globalBudgetPercents) ? parsed.globalBudgetPercents : {}
    };
}

const BUSINESS_CREDITS_PER_SEAT = 1900;
const ENTERPRISE_CREDITS_PER_SEAT = 3900;
const CREDITS_PER_DOLLAR = 100;
// 10000% allows 100x capacity stress scenarios while still preventing accidental massive inputs.
const MAX_GLOBAL_USAGE_PERCENT = 10000;

function dollarsToCredits(amount) {
    return Math.round((Math.max(0, amount) * CREDITS_PER_DOLLAR) + Number.EPSILON);
}

function creditsToDollars(credits) {
    return Math.max(0, credits) / CREDITS_PER_DOLLAR;
}

function formatBudgetDollarsFromCredits(credits) {
    return `$${creditsToDollars(credits).toFixed(2)}`;
}

function formatAICreditReference(credits) {
    return `${fmt(Math.round(Math.max(0, credits)))} AI credits`;
}

function formatBudgetWithCreditReferenceFromCredits(credits) {
    return `${formatBudgetDollarsFromCredits(credits)} (${formatAICreditReference(credits)})`;
}

function formatBudgetWithCreditReferenceFromDollars(amount) {
    const safeAmount = Math.max(0, Number(amount) || 0);
    return `$${safeAmount.toFixed(2)} (${formatAICreditReference(meteredCreditsFromBudget(safeAmount))})`;
}

function meteredCreditsFromBudget(amount) {
    return Math.floor((Math.max(0, amount) * CREDITS_PER_DOLLAR) + Number.EPSILON);
}

function totalPool() {
    return (state.enterprise.businessSeats * BUSINESS_CREDITS_PER_SEAT)
        + (state.enterprise.enterpriseSeats * ENTERPRISE_CREDITS_PER_SEAT);
}

function totalSeats() {
    return state.enterprise.businessSeats + state.enterprise.enterpriseSeats;
}

function userCreditsPerSeat(user) {
    return user.license === 'enterprise'
        ? ENTERPRISE_CREDITS_PER_SEAT
        : BUSINESS_CREDITS_PER_SEAT;
}

// ─── Persistence ─────────────────────────────────────────────────────────────
function saveState() {
    localStorage.setItem('budget-simulator-state', JSON.stringify(state));
}

function loadState() {
    try {
        const saved = localStorage.getItem('budget-simulator-state');
        if (!saved) return null;
        return normalizeState(JSON.parse(saved));
    } catch { return null; }
}

function handleFormSubmit(event, action) {
    event.preventDefault();
    action();
}

function getUserAssignments() {
    return {
        costCenterId: document.getElementById('userCC').value || null,
        orgId: document.getElementById('userOrg').value || null,
        teamId: document.getElementById('userTeam').value || null,
        license: document.getElementById('userLicense').value
    };
}

function updateUserCreateMode() {
    const isSingle = document.getElementById('userCreateMode').value === 'single';
    const singleGroup = document.getElementById('singleUserFields');
    const bulkCountGroup = document.getElementById('bulkCountGroup');
    const bulkPrefixGroup = document.getElementById('bulkPrefixGroup');
    const userNameInput = document.getElementById('userName');
    const bulkCountInput = document.getElementById('bulkCount');
    const bulkPrefixInput = document.getElementById('bulkPrefix');
    const helpText = document.getElementById('userCreateHelp');
    const submitButton = document.getElementById('userCreateSubmit');

    singleGroup.hidden = !isSingle;
    bulkCountGroup.hidden = isSingle;
    bulkPrefixGroup.hidden = isSingle;
    userNameInput.disabled = !isSingle;
    bulkCountInput.disabled = isSingle;
    bulkPrefixInput.disabled = isSingle;
    helpText.textContent = isSingle
        ? 'Create one user or switch to bulk mode to generate multiple users with the same assignments.'
        : 'Generate multiple users at once. Every created user will inherit the selected cost center, organization, team, and license.';
    submitButton.textContent = isSingle ? '+ Add User' : '⚡ Generate Users';
}

function submitUserCreation() {
    if (document.getElementById('userCreateMode').value === 'bulk') {
        bulkCreateUsers();
        return;
    }
    addUser();
}

function exportConfig() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'budget-simulator-config.json';
    a.click();
    URL.revokeObjectURL(url);
}

function applyConfiguration(configuration) {
    state = normalizeState(configuration);
    saveState();
    renderAll();
}

function importConfig(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            applyConfiguration(JSON.parse(e.target.result));
        } catch (err) { alert('Invalid JSON file: ' + err.message); }
    };
    reader.onerror = () => alert('Unable to read the selected configuration file.');
    reader.readAsText(file);
    event.target.value = '';
}

async function loadSampleConfig() {
    if (hasConfigurationChanges() && !confirm('Replace the current configuration with sample data?')) return;

    try {
        const response = await fetch('budget-simulator-sample.json');
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        applyConfiguration(await response.json());
    } catch (err) {
        alert('Unable to load sample data: ' + err.message);
    }
}

function resetAll() {
    if (!confirm('Reset all configuration? This cannot be undone.')) return;
    state = defaultState();
    saveState();
    renderAll();
}

// ─── Enterprise ──────────────────────────────────────────────────────────────
function updateEnterprise() {
    if (!state.enterprise.autoSeats) {
        state.enterprise.businessSeats = parseInt(document.getElementById('businessSeats').value) || 0;
        state.enterprise.enterpriseSeats = parseInt(document.getElementById('enterpriseSeats').value) || 0;
    }
    state.enterprise.meteredEnabled = document.getElementById('meteredEnabled').checked;
    saveState();
    renderEnterpriseStats();
    renderCCPoolToggles();
}

function toggleAutoSeats() {
    state.enterprise.autoSeats = document.getElementById('autoSeats').checked;
    recalcAutoSeats();
    saveState();
    renderEnterprise();
}

function recalcAutoSeats() {
    if (state.enterprise.autoSeats) {
        state.enterprise.businessSeats = state.users.filter(u => u.license !== 'enterprise').length;
        state.enterprise.enterpriseSeats = state.users.filter(u => u.license === 'enterprise').length;
        saveState();
    }
}

function renderEnterprise() {
    document.getElementById('businessSeats').value = state.enterprise.businessSeats;
    document.getElementById('enterpriseSeats').value = state.enterprise.enterpriseSeats;
    document.getElementById('meteredEnabled').checked = state.enterprise.meteredEnabled;
    // Auto seats
    const auto = state.enterprise.autoSeats || false;
    document.getElementById('autoSeats').checked = auto;
    document.getElementById('businessSeats').disabled = auto;
    document.getElementById('enterpriseSeats').disabled = auto;
    renderEnterpriseStats();
    renderTeams();
    renderOrgs();
    renderCCPoolToggles();
}

function renderEnterpriseStats() {
    const pool = totalPool();
    const reserved = state.costCenters.filter(cc => cc.poolEnabled).reduce((s, cc) => s + getCCPoolSize(cc), 0);
    document.getElementById('enterpriseStats').innerHTML = `
        <div class="stat-card" data-enterprise-stat="total-pool"><div class="stat-value">${fmt(pool)}</div><div class="stat-label">Total Pool Credits</div></div>
        <div class="stat-card" data-enterprise-stat="business-seats"><div class="stat-value">${state.enterprise.businessSeats}</div><div class="stat-label">Business Seats</div></div>
        <div class="stat-card" data-enterprise-stat="enterprise-seats"><div class="stat-value">${state.enterprise.enterpriseSeats}</div><div class="stat-label">Enterprise Seats</div></div>
        <div class="stat-card" data-enterprise-stat="reserved-pool"><div class="stat-value">${fmt(reserved)}</div><div class="stat-label">Reserved (CC Pools)</div></div>
        <div class="stat-card" data-enterprise-stat="unreserved-pool"><div class="stat-value">${fmt(pool - reserved)}</div><div class="stat-label">Unreserved Pool</div></div>
    `;
}

// ─── Teams ───────────────────────────────────────────────────────────────────
function addTeam() {
    const name = document.getElementById('teamName').value.trim();
    if (!name) return;
    if (state.teams.some(t => t.name === name)) return alert('Team already exists');
    state.teams.push({ id: 'team_' + Date.now(), name });
    document.getElementById('teamName').value = '';
    saveState();
    renderTeams();
    renderCCTeamDropdown();
    renderUserTeamDropdown();
}

function deleteTeam(id) {
    state.teams = state.teams.filter(t => t.id !== id);
    state.users.forEach(u => { if (u.teamId === id) u.teamId = null; });
    state.costCenters.forEach(cc => {
        if (cc.teamId === id) cc.teamId = null;
        if (cc.teamIds) cc.teamIds = cc.teamIds.filter(tid => tid !== id);
    });
    saveState();
    renderTeams();
    renderCCTeamDropdown();
    renderUserTeamDropdown();
}

function renderTeams() {
    const el = document.getElementById('teamsList');
    if (state.teams.length === 0) { el.innerHTML = '<p class="help-text">No teams yet.</p>'; return; }
    el.innerHTML = '<table><thead><tr><th>Team</th><th>Members</th><th></th></tr></thead><tbody>' +
        state.teams.map(t => {
            const members = state.users.filter(u => u.teamId === t.id);
            return `<tr><td><strong>${escapeHtml(t.name)}</strong></td><td>${members.length > 0 ? members.map(u => escapeHtml(u.name)).join(', ') : '—'}</td><td><button class="btn-danger btn-sm" onclick="deleteTeam('${escapeInlineArg(t.id)}')">✕</button></td></tr>`;
        }).join('') + '</tbody></table>';
}

// ─── Organizations ───────────────────────────────────────────────────────────
function addOrg() {
    const name = document.getElementById('orgName').value.trim();
    if (!name) return;
    if (state.orgs.some(o => o.name === name)) return alert('Organization already exists');
    state.orgs.push({ id: 'org_' + Date.now(), name, budget: null, budgetHardStop: true });
    document.getElementById('orgName').value = '';
    saveState();
    renderOrgs();
    renderUserOrgDropdown();
    renderBudgets();
    renderCCOrgDropdown();
}

function deleteOrg(id) {
    state.orgs = state.orgs.filter(o => o.id !== id);
    state.users.forEach(u => { if (u.orgId === id) u.orgId = null; });
    state.costCenters.forEach(cc => {
        if (cc.orgIds) cc.orgIds = cc.orgIds.filter(oid => oid !== id);
    });
    saveState();
    renderOrgs();
    renderUserOrgDropdown();
    renderBudgets();
    renderCCOrgDropdown();
}

function renderOrgs() {
    const el = document.getElementById('orgsList');
    if (state.orgs.length === 0) { el.innerHTML = '<p class="help-text">No organizations yet.</p>'; return; }
    el.innerHTML = '<table><thead><tr><th>Organization</th><th>Members</th><th></th></tr></thead><tbody>' +
        state.orgs.map(o => {
            const members = state.users.filter(u => u.orgId === o.id);
            return `<tr><td><strong>${escapeHtml(o.name)}</strong></td><td>${members.length > 0 ? members.map(u => escapeHtml(u.name)).join(', ') : '—'}</td><td><button class="btn-danger btn-sm" onclick="deleteOrg('${escapeInlineArg(o.id)}')">✕</button></td></tr>`;
        }).join('') + '</tbody></table>';
}

// ─── CC Pool Toggles (on Simulate tab) ───────────────────────────────────────
function toggleCCPool(ccId, enabled) {
    const cc = state.costCenters.find(c => c.id === ccId);
    if (cc) cc.poolEnabled = enabled;
    saveState();
    renderCCPoolToggles();
    renderEnterpriseStats();
    renderGlobalBudgetSimulation();
}

function renderCCPoolToggles() {
    const el = document.getElementById('ccPoolToggles');
    if (!el) return;
    if (state.costCenters.length === 0) {
        el.innerHTML = '<p class="help-text">No cost centers yet. Create them in the Cost Centers tab.</p>';
        return;
    }
    el.innerHTML = '<table><thead><tr><th>Cost Center</th><th>Pool Enabled</th><th>Members</th><th>Pool Size</th></tr></thead><tbody>' +
        state.costCenters.map(cc => {
            const members = getAssignedCCMembers(cc);
            const poolSize = getCCPoolSize(cc);
            return `<tr data-cc-id="${escapeHtml(cc.id)}">
                <td><strong>${escapeHtml(cc.name)}</strong></td>
                <td><label class="checkbox-label"><input type="checkbox" data-role="pool-toggle" ${cc.poolEnabled ? 'checked' : ''} onchange="toggleCCPool('${escapeInlineArg(cc.id)}', this.checked)"> ${cc.poolEnabled ? 'Active' : 'Inactive'}</label></td>
                <td>${members.length}</td>
                <td>${cc.poolEnabled ? fmt(poolSize) + ' credits' : '—'}</td>
            </tr>`;
        }).join('') + '</tbody></table>';
}

// ─── Cost Centers ────────────────────────────────────────────────────────────
function addCostCenter() {
    const name = document.getElementById('ccName').value.trim();
    if (!name) return alert('Name is required');
    if (state.costCenters.some(cc => cc.name === name)) return alert('Cost center already exists');

    const teamSelect = document.getElementById('ccTeam');
    const orgSelect = document.getElementById('ccOrgs');
    const userSelect = document.getElementById('ccUsers');
    const teamIds = Array.from(teamSelect.selectedOptions).map(o => o.value).filter(Boolean);
    const orgIds = Array.from(orgSelect.selectedOptions).map(o => o.value).filter(Boolean);
    const userIds = Array.from(userSelect.selectedOptions).map(o => o.value).filter(Boolean);

    state.costCenters.push({
        id: 'cc_' + Date.now(),
        name,
        teamIds,
        orgIds,
        userIds,
        // Legacy compat
        teamId: teamIds[0] || null,
        poolEnabled: false,
        overagesAllowed: true,
        budget: null,
        budgetHardStop: true,
        ulb: null
    });
    document.getElementById('ccName').value = '';
    teamSelect.selectedIndex = -1;
    orgSelect.selectedIndex = -1;
    userSelect.selectedIndex = -1;
    saveState();
    renderCostCenters();
    renderUserCCDropdown();
    renderCCPoolToggles();
    renderEnterpriseStats();
    renderBudgets();
    renderTabCounts();
}

function deleteCostCenter(id) {
    state.costCenters = state.costCenters.filter(cc => cc.id !== id);
    state.users.forEach(u => { if (u.costCenterId === id) u.costCenterId = null; });
    saveState();
    renderCostCenters();
    renderUserCCDropdown();
    renderCCPoolToggles();
    renderEnterpriseStats();
    renderBudgets();
    renderTabCounts();
}

function updateCC(id, field, value) {
    const cc = state.costCenters.find(c => c.id === id);
    if (!cc) return;
    if (field === 'overagesAllowed') cc[field] = value;
    else if (field === 'name') cc.name = value;
    else if (field === 'teamIds') { cc.teamIds = value; cc.teamId = value[0] || null; }
    else if (field === 'orgIds') cc.orgIds = value;
    else if (field === 'userIds') cc.userIds = value;
    saveState();
    renderCostCenters();
    renderEnterpriseStats();
    renderCCPoolToggles();
}

function getCCMembers(cc) {
    const memberSet = new Set();
    // Users directly assigned to CC
    state.users.filter(u => u.costCenterId === cc.id).forEach(u => memberSet.add(u.id));
    // Users in CC's userIds list
    if (cc.userIds) cc.userIds.forEach(uid => memberSet.add(uid));
    // Users in assigned teams
    const teamIds = cc.teamIds || (cc.teamId ? [cc.teamId] : []);
    teamIds.forEach(tid => {
        state.users.filter(u => u.teamId === tid).forEach(u => memberSet.add(u.id));
    });
    // Users in assigned orgs
    if (cc.orgIds) {
        cc.orgIds.forEach(oid => {
            state.users.filter(u => u.orgId === oid).forEach(u => memberSet.add(u.id));
        });
    }
    return state.users.filter(u => memberSet.has(u.id));
}

function getAssignedCCMembers(cc) {
    return state.users.filter(u => getUserCC(u)?.id === cc.id);
}

function getCCPoolSize(cc) {
    if (!cc.poolEnabled) return 0;
    return getAssignedCCMembers(cc).reduce((sum, u) => sum + userCreditsPerSeat(u), 0);
}

function getOverageBudgetTargets(scope) {
    if (!scope || typeof scope !== 'object') return [];
    if (scope.type === 'enterprise') {
        return state.users.filter(user => !userHasIndependentCostCenterBudget(user));
    }
    if (scope.type === 'cc') {
        return scope.cc ? getAssignedCCMembers(scope.cc) : [];
    }
    if (scope.type === 'org') {
        return scope.org ? state.users.filter(u => u.orgId === scope.org.id) : [];
    }
    return [];
}

function getUserPoolEntitlement(user) {
    const cc = getUserCC(user);
    if (cc && cc.poolEnabled) return userCreditsPerSeat(user);
    const reserved = state.costCenters
        .filter(costCenter => costCenter.poolEnabled)
        .reduce((sum, costCenter) => sum + getCCPoolSize(costCenter), 0);
    const entPool = totalPool() - reserved;
    const eligible = state.users.filter(u => {
        const costCenter = getUserCC(u);
        return !costCenter || !costCenter.poolEnabled;
    });
    if (eligible.length === 0) return 0;
    return entPool / eligible.length;
}

function orgMapIdList(primaryId, ids) {
    const requested = new Set([
        primaryId,
        ...(Array.isArray(ids) ? ids : [])
    ].filter(id => id !== null && id !== undefined && id !== ''));
    return requested;
}

function orgMapMemberships(user, items, singularField, pluralField) {
    const requested = orgMapIdList(user[singularField], user[pluralField]);
    return items
        .filter(item => requested.has(item.id))
        .map(item => ({ id: item.id, name: item.name }));
}

function orgMapGroup(type, item = null) {
    return {
        type,
        id: item ? item.id : 'direct',
        name: item ? item.name : 'Direct users',
        users: [],
        usage: 0
    };
}

function buildOrgMapModel() {
    const users = Array.isArray(state.users) ? state.users : [];
    const teams = Array.isArray(state.teams) ? state.teams : [];
    const orgs = Array.isArray(state.orgs) ? state.orgs : [];
    const costCenters = Array.isArray(state.costCenters) ? state.costCenters : [];
    const usage = state.usage && typeof state.usage === 'object' ? state.usage : {};
    const usageBaseline = state.usageBaseline && typeof state.usageBaseline === 'object' ? state.usageBaseline : {};
    const lastCallOutcomes = state.lastCallOutcomes && typeof state.lastCallOutcomes === 'object'
        ? state.lastCallOutcomes
        : {};

    const effectiveCCByUser = new Map(users.map(user => [user, getUserCC(user)]));
    const assignedTeamCC = new Map();
    const assignedOrgCC = new Map();

    costCenters.forEach(cc => {
        const teamIds = orgMapIdList(cc.teamId, cc.teamIds);
        teams.forEach(team => {
            if (teamIds.has(team.id) && !assignedTeamCC.has(team.id)) assignedTeamCC.set(team.id, cc.id);
        });
        const orgIds = orgMapIdList(null, cc.orgIds);
        orgs.forEach(org => {
            if (orgIds.has(org.id) && !assignedOrgCC.has(org.id)) assignedOrgCC.set(org.id, cc.id);
        });
    });

    const destinations = [
        ...costCenters.map(cc => ({ id: cc.id, source: cc, isUnassigned: false })),
        { id: null, source: null, isUnassigned: true }
    ];

    const costCenterNodes = destinations.map(destination => {
        const destinationUsers = users.filter(user => (effectiveCCByUser.get(user)?.id || null) === destination.id);
        const destinationUserSet = new Set(destinationUsers);
        const teamGroups = teams
            .filter(team => (assignedTeamCC.get(team.id) || null) === destination.id ||
                destinationUsers.some(user => orgMapIdList(user.teamId, user.teamIds).has(team.id)))
            .map(team => orgMapGroup('team', team));
        const organizationGroups = orgs
            .filter(org => (assignedOrgCC.get(org.id) || null) === destination.id ||
                destinationUsers.some(user => orgMapIdList(user.orgId, user.orgIds).has(org.id)))
            .map(org => orgMapGroup('organization', org));
        const directGroup = orgMapGroup('direct');
        const groups = [...teamGroups, ...organizationGroups, directGroup];
        const teamGroupById = new Map(teamGroups.map(group => [group.id, group]));
        const orgGroupById = new Map(organizationGroups.map(group => [group.id, group]));

        users.forEach(user => {
            if (!destinationUserSet.has(user)) return;

            const userTeams = orgMapMemberships(user, teams, 'teamId', 'teamIds');
            const userOrganizations = orgMapMemberships(user, orgs, 'orgId', 'orgIds');
            const group = (userTeams.length > 0 && teamGroupById.get(userTeams[0].id)) ||
                (userOrganizations.length > 0 && orgGroupById.get(userOrganizations[0].id)) ||
                directGroup;
            const userUsage = Number(usage[user.id]) || 0;
            const userNode = {
                ...user,
                teamIds: userTeams.map(team => team.id),
                orgIds: userOrganizations.map(org => org.id),
                memberships: {
                    teams: userTeams,
                    organizations: userOrganizations
                },
                groupedBy: { type: group.type, id: group.id },
                effectiveCostCenterId: destination.id,
                creditsPerSeat: userCreditsPerSeat(user),
                usage: userUsage,
                usageBaseline: Number(usageBaseline[user.id]) || 0,
                lastCallOutcome: lastCallOutcomes[user.id]
                    ? { ...lastCallOutcomes[user.id] }
                    : null
            };
            group.users.push(userNode);
            const aggregateGroups = [
                ...userTeams.map(team => teamGroupById.get(team.id)).filter(Boolean),
                ...userOrganizations.map(org => orgGroupById.get(org.id)).filter(Boolean)
            ];
            (aggregateGroups.length > 0 ? aggregateGroups : [directGroup]).forEach(aggregateGroup => {
                if (!Array.isArray(aggregateGroup.aggregateUsers)) aggregateGroup.aggregateUsers = [];
                aggregateGroup.aggregateUsers.push(userNode);
                aggregateGroup.usage += userUsage;
            });
        });

        const source = destination.source;
        const assignedMembers = source ? getAssignedCCMembers(source) : destinationUsers;
        groups.forEach(group => {
            if (!Array.isArray(group.aggregateUsers)) group.aggregateUsers = [...group.users];
            group.memberCount = group.aggregateUsers.length;
        });
        const nodeUsage = destinationUsers.reduce((sum, user) => sum + (Number(usage[user.id]) || 0), 0);
        return {
            ...(source ? {
                ...source,
                teamIds: [...orgMapIdList(source.teamId, source.teamIds)],
                orgIds: [...orgMapIdList(null, source.orgIds)],
                userIds: [...orgMapIdList(null, source.userIds)]
            } : {
                id: 'unassigned',
                name: 'Unassigned',
                poolEnabled: false,
                overagesAllowed: true,
                budget: null,
                budgetHardStop: true,
                ulb: null
            }),
            type: 'cost-center',
            isUnassigned: destination.isUnassigned,
            memberCount: assignedMembers.length,
            poolSize: source ? getCCPoolSize(source) : 0,
            usage: nodeUsage,
            groups
        };
    });

    const visibleCostCenters = costCenterNodes.filter(node =>
        !node.isUnassigned ||
        node.memberCount > 0 ||
        node.groups.some(group => group.type !== 'direct')
    );
    const enterpriseUsage = users.reduce((sum, user) => sum + (Number(usage[user.id]) || 0), 0);
    const enterprise = state.enterprise && typeof state.enterprise === 'object' ? state.enterprise : {};

    return {
        ...enterprise,
        type: 'enterprise',
        id: 'enterprise',
        name: enterprise.name || 'Enterprise',
        businessSeats: Number(enterprise.businessSeats) || 0,
        enterpriseSeats: Number(enterprise.enterpriseSeats) || 0,
        totalSeats: totalSeats(),
        totalPool: totalPool(),
        usage: enterpriseUsage,
        userCount: users.length,
        costCenters: visibleCostCenters
    };
}

function orgMapHasBudget(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function orgMapBudgetId(kind, sourceLevel, sourceId, targetLevel, targetId) {
    return ['orgmap-budget', kind, sourceLevel, sourceId, 'for', targetLevel, targetId]
        .map(part => encodeURIComponent(String(part)))
        .join(':');
}

function orgMapBudgetDescriptor(kind, source, target, options) {
    return {
        id: orgMapBudgetId(kind, source.level, source.id, target.level, target.id),
        kind,
        level: source.level,
        amount: Number(options.amount),
        amountUnit: options.amountUnit,
        hardStop: Boolean(options.hardStop),
        effective: false,
        shadowedBy: null,
        inherited: source.level !== target.level || source.id !== (target.sourceId || target.id),
        rule: '',
        title: options.title,
        sourceName: source.name,
        reason: options.reason
    };
}

function orgMapFinalizeBudgetChain(descriptors) {
    if (descriptors.length === 0) return descriptors;
    const effective = descriptors[descriptors.length - 1];
    return descriptors.map(descriptor => {
        const isEffective = descriptor.id === effective.id;
        const rule = isEffective
            ? descriptor.reason
            : `${descriptor.title} does not apply here because ${effective.title} has higher precedence.`;
        const { reason, ...result } = descriptor;
        return {
            ...result,
            effective: isEffective,
            shadowedBy: isEffective ? null : effective.id,
            rule
        };
    });
}

function orgMapFinalizeConcurrentBudgets(descriptors) {
    return descriptors.map(descriptor => {
        const { reason, ...result } = descriptor;
        return {
            ...result,
            effective: true,
            shadowedBy: null,
            rule: reason
        };
    });
}

function collectOrgMapBudgets(node, context = {}) {
    if (!node || typeof node !== 'object') return [];

    const enterprise = context.enterprise || (node.type === 'enterprise' ? node : state.enterprise) || {};
    const nodeIsCostCenter = node.type === 'cost-center';
    const nodeIsGroup = node.type === 'organization' || node.type === 'team' || node.type === 'direct';
    const nodeIsUser = !nodeIsCostCenter && !nodeIsGroup && node.type !== 'enterprise';
    const targetLevel = node.type === 'cost-center'
        ? 'cost-center'
        : (node.type === 'organization' ? 'organization' : (node.type === 'team' ? 'team' : (node.type === 'enterprise' ? 'enterprise' : (node.type === 'direct' ? 'group' : 'user'))));
    const requestedCostCenterId = nodeIsCostCenter
        ? node.id
        : (node.effectiveCostCenterId || context.costCenter?.id);
    const costCenter = nodeIsCostCenter
        ? node
        : (context.costCenter && context.costCenter.id === requestedCostCenterId
            ? context.costCenter
            : state.costCenters.find(cc => cc.id === requestedCostCenterId));
    const organization = node.type === 'organization'
        ? state.orgs.find(org => org.id === node.id)
        : (nodeIsUser
            ? (node.orgId
                ? state.orgs.find(org => org.id === node.orgId)
                : (context.organization || context.org || null))
            : null);
    const targetSourceId = node.id || targetLevel;
    const target = {
        level: targetLevel,
        sourceId: targetSourceId,
        id: nodeIsGroup
            ? `${costCenter?.id || 'unassigned'}:${targetSourceId}`
            : targetSourceId
    };

    const ulbs = [];
    if (orgMapHasBudget(enterprise.universalULB)) {
        ulbs.push(orgMapBudgetDescriptor('ulb',
            { level: 'enterprise', id: enterprise.id || 'enterprise', name: enterprise.name || 'Enterprise' },
            target, {
                amount: enterprise.universalULB,
                amountUnit: 'credits',
                hardStop: true,
                title: 'Universal ULB',
                reason: 'Applies because no cost-center or individual ULB with higher precedence is configured for this scope.'
            }));
    }
    if (costCenter && !costCenter.isUnassigned && orgMapHasBudget(costCenter.ulb)) {
        ulbs.push(orgMapBudgetDescriptor('ulb',
            { level: 'cost-center', id: costCenter.id, name: costCenter.name },
            target, {
                amount: costCenter.ulb,
                amountUnit: 'credits',
                hardStop: true,
                title: `${costCenter.name} ULB`,
                reason: 'Applies because the effective cost center has a ULB and no individual ULB overrides it.'
            }));
    }
    if (nodeIsUser && orgMapHasBudget(node.individualULB)) {
        ulbs.push(orgMapBudgetDescriptor('ulb',
            { level: 'user', id: node.id, name: node.name },
            target, {
                amount: node.individualULB,
                amountUnit: 'credits',
                hardStop: true,
                title: `${node.name} individual ULB`,
                reason: 'Applies because an individual ULB has the highest precedence.'
            }));
    }

    const overages = [];
    if (orgMapHasBudget(enterprise.enterpriseBudget)) {
        overages.push(orgMapBudgetDescriptor('overage',
            { level: 'enterprise', id: enterprise.id || 'enterprise', name: enterprise.name || 'Enterprise' },
            target, {
                amount: enterprise.enterpriseBudget,
                amountUnit: 'dollars',
                hardStop: enterprise.enterpriseHardStop,
                title: 'Enterprise overage budget',
                reason: 'Applies concurrently to all enterprise metered usage. Organization and cost-center budgets can also limit the same usage.'
            }));
    }
    if (organization && orgMapHasBudget(organization.budget)) {
        overages.push(orgMapBudgetDescriptor('overage',
            { level: 'organization', id: organization.id, name: organization.name },
            target, {
                amount: organization.budget,
                amountUnit: 'dollars',
                hardStop: organization.budgetHardStop,
                title: `${organization.name} overage budget`,
                reason: 'Applies concurrently to metered usage from this organization, alongside any cost-center and enterprise budgets.'
            }));
    }
    if (costCenter && !costCenter.isUnassigned && orgMapHasBudget(costCenter.budget)) {
        overages.push(orgMapBudgetDescriptor('overage',
            { level: 'cost-center', id: costCenter.id, name: costCenter.name },
            target, {
                amount: costCenter.budget,
                amountUnit: 'dollars',
                hardStop: costCenter.budgetHardStop,
                title: `${costCenter.name} overage budget`,
                reason: 'Applies concurrently to metered usage from this cost center, alongside any organization and enterprise budgets.'
            }));
    }

    const pools = [];
    if (costCenter && !costCenter.isUnassigned && costCenter.poolEnabled) {
        const pool = orgMapBudgetDescriptor('pool',
            { level: 'cost-center', id: costCenter.id, name: costCenter.name },
            target, {
                amount: orgMapHasBudget(costCenter.poolSize) ? costCenter.poolSize : getCCPoolSize(costCenter),
                amountUnit: 'credits',
                hardStop: costCenter.overagesAllowed === false,
                title: `${costCenter.name} reserved pool`,
                reason: ''
            });
        const { reason, ...poolDescriptor } = pool;
        pools.push({
            ...poolDescriptor,
            effective: true,
            rule: costCenter.overagesAllowed === false
                ? 'Members draw from this reserved pool first; when it is exhausted, overages are not allowed and usage is blocked.'
                : 'Members draw from this reserved pool first, then may continue through enterprise pool and metered routing.'
        });
    }

    return [
        ...orgMapFinalizeBudgetChain(ulbs),
        ...orgMapFinalizeConcurrentBudgets(overages),
        ...pools
    ];
}

function renderCCTeamDropdown() {
    const sel = document.getElementById('ccTeam');
    sel.innerHTML = state.teams.map(t => optionHtml(t.id, t.name)).join('');
    sel.selectedIndex = -1;
}

function renderCCOrgDropdown() {
    const sel = document.getElementById('ccOrgs');
    sel.innerHTML = state.orgs.map(o => optionHtml(o.id, o.name)).join('');
    sel.selectedIndex = -1;
}

function renderCCUserDropdown() {
    const sel = document.getElementById('ccUsers');
    sel.innerHTML = state.users.map(u => optionHtml(u.id, u.name)).join('');
    sel.selectedIndex = -1;
}

function renderCostCenters() {
    const container = document.getElementById('costCentersList');
    if (state.costCenters.length === 0) {
        container.innerHTML = '<div class="card empty-state"><p>No cost centers yet. Add one above.</p></div>';
        return;
    }
    container.innerHTML = state.costCenters.map(cc => {
        const members = getCCMembers(cc);
        const teamIds = cc.teamIds || (cc.teamId ? [cc.teamId] : []);
        const orgIds = cc.orgIds || [];
        const userIds = cc.userIds || [];

        return `<div class="card">
            <h2>${escapeHtml(cc.name)} ${cc.poolEnabled ? '<span class="badge badge-success">Pool Active</span>' : '<span class="badge badge-warning">No Pool</span>'}</h2>
            <div class="form-row">
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" value="${escapeHtml(cc.name)}" onchange="updateCC('${escapeInlineArg(cc.id)}','name',this.value)">
                </div>
                <div class="form-group">
                    <label>Teams</label>
                    <select multiple style="min-height:50px" onchange="updateCC('${escapeInlineArg(cc.id)}','teamIds',Array.from(this.selectedOptions).map(o=>o.value))">
                        ${state.teams.map(t => optionHtml(t.id, t.name, teamIds.includes(t.id))).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Organizations</label>
                    <select multiple style="min-height:50px" onchange="updateCC('${escapeInlineArg(cc.id)}','orgIds',Array.from(this.selectedOptions).map(o=>o.value))">
                        ${state.orgs.map(o => optionHtml(o.id, o.name, orgIds.includes(o.id))).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Direct Users</label>
                    <select multiple style="min-height:50px" onchange="updateCC('${escapeInlineArg(cc.id)}','userIds',Array.from(this.selectedOptions).map(o=>o.value))">
                        ${state.users.map(u => optionHtml(u.id, u.name, userIds.includes(u.id))).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row" style="margin-top: 8px">
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" ${cc.overagesAllowed ? 'checked' : ''} onchange="updateCC('${escapeInlineArg(cc.id)}','overagesAllowed',this.checked)">
                        Overages allowed (fall through to enterprise pool when CC pool exhausted)
                    </label>
                </div>
            </div>
            <div style="margin-top: 8px">
                <label style="font-size: 0.8125rem; color: var(--color-text-muted)">Resolved Members (${members.length}): </label>
                <span style="font-size: 0.8125rem">${members.length > 0 ? members.map(u => escapeHtml(u.name)).join(', ') : '<em>None</em>'}</span>
            </div>
            <div style="margin-top: 12px">
                <button class="btn-danger btn-sm" onclick="deleteCostCenter('${escapeInlineArg(cc.id)}')">Delete Cost Center</button>
            </div>
        </div>`;
    }).join('');
}

// ─── Users ───────────────────────────────────────────────────────────────────
let editingUserId = null;
const userPanelState = {};

function setUserPanelOpen(id, isOpen) {
    userPanelState[id] = isOpen;
}

function addUser() {
    const name = document.getElementById('userName').value.trim();
    if (!name) return alert('Username is required');
    if (state.users.some(u => u.name === name)) return alert('User already exists');
    const assignments = getUserAssignments();
    state.users.push({
        id: 'user_' + Date.now(),
        name,
        costCenterId: assignments.costCenterId,
        orgId: assignments.orgId,
        teamId: assignments.teamId,
        license: assignments.license,
        individualULB: null
    });
    document.getElementById('userName').value = '';
    saveState();
    refreshAfterUserChange();
}

function deleteUser(id) {
    state.users = state.users.filter(u => u.id !== id);
    delete state.usage[id];
    delete state.usageBaseline[id];
    if (state.lastCallOutcomes) delete state.lastCallOutcomes[id];
    if (Array.isArray(state.usageSequence)) state.usageSequence = state.usageSequence.filter(uid => uid !== id);
    // Remove from CC userIds
    state.costCenters.forEach(cc => {
        if (cc.userIds) cc.userIds = cc.userIds.filter(uid => uid !== id);
    });
    saveState();
    refreshAfterUserChange();
}

function editUser(id) {
    editingUserId = editingUserId === id ? null : id;
    if (id) userPanelState[id] = true;
    renderUsers();
}

function saveUserEdit(id) {
    const user = state.users.find(u => u.id === id);
    if (!user) return;
    const row = document.getElementById('edit-' + id);
    if (!row) return;
    user.costCenterId = row.querySelector('[data-field="cc"]').value || null;
    user.orgId = row.querySelector('[data-field="org"]').value || null;
    user.teamId = row.querySelector('[data-field="team"]').value || null;
    user.license = row.querySelector('[data-field="license"]').value;
    editingUserId = null;
    userPanelState[id] = true;
    saveState();
    refreshAfterUserChange();
}

function refreshAfterUserChange() {
    renderUsers();
    renderCostCenters();
    renderTeams();
    renderOrgs();
    renderEnterpriseStats();
    renderCCPoolToggles();
    renderBudgets();
    renderCCUserDropdown();
    renderTabCounts();
    recalcAutoSeats();
    renderGlobalBudgetSimulation();
    document.getElementById('simulationResultsCard').style.display = 'none';
}

function bulkCreateUsers() {
    const count = parseInt(document.getElementById('bulkCount').value) || 0;
    const prefix = document.getElementById('bulkPrefix').value.trim() || 'user';
    const assignments = getUserAssignments();
    if (count <= 0) return alert('Enter a positive number');

    const existingNumbers = state.users
        .map(u => { const m = u.name.match(new RegExp(`^${prefix}-(\\d+)$`)); return m ? parseInt(m[1]) : 0; })
        .filter(n => n > 0);
    let nextNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;

    for (let i = 0; i < count; i++) {
        const name = `${prefix}-${nextNum + i}`;
        if (state.users.some(u => u.name === name)) continue;

        state.users.push({
            id: 'user_' + (Date.now() + i),
            name,
            costCenterId: assignments.costCenterId,
            orgId: assignments.orgId,
            teamId: assignments.teamId,
            license: assignments.license,
            individualULB: null
        });
    }
    saveState();
    refreshAfterUserChange();
}

function getEffectiveULB(user) {
    if (user.individualULB !== null) return { value: user.individualULB, source: 'Individual' };
    const cc = getUserCC(user);
    if (cc && cc.ulb !== null) return { value: cc.ulb, source: `CC: ${cc.name}` };
    if (state.enterprise.universalULB !== null) return { value: state.enterprise.universalULB, source: 'Universal' };
    return { value: null, source: 'None' };
}

function renderUserCCDropdown() {
    document.getElementById('userCC').innerHTML = '<option value="">(None)</option>' +
        state.costCenters.map(cc => optionHtml(cc.id, cc.name)).join('');
}

function renderUserOrgDropdown() {
    document.getElementById('userOrg').innerHTML = '<option value="">(None)</option>' +
        state.orgs.map(o => optionHtml(o.id, o.name)).join('');
}

function renderUserTeamDropdown() {
    document.getElementById('userTeam').innerHTML = '<option value="">(None)</option>' +
        state.teams.map(t => optionHtml(t.id, t.name)).join('');
}

function renderUsers() {
    const container = document.getElementById('usersList');
    if (state.users.length === 0) {
        container.innerHTML = '<div class="card empty-state"><p>No users yet. Add one above.</p></div>';
        return;
    }
    let html = `<div class="card"><p style="margin-bottom:8px; font-size:0.8125rem; color:var(--color-text-muted)">${state.users.length} user(s)</p><div class="user-panel-list">`;
    state.users.forEach(u => {
        const cc = u.costCenterId ? state.costCenters.find(c => c.id === u.costCenterId) : null;
        const org = u.orgId ? state.orgs.find(o => o.id === u.orgId) : null;
        const team = u.teamId ? state.teams.find(t => t.id === u.teamId) : null;
        const ulb = getEffectiveULB(u);
        const panelOpen = userPanelState[u.id] !== false;
        const summaryMeta = [
            `<span class="badge badge-info">${escapeHtml(u.license || 'business')}</span>`,
            `<span class="tag">CC: ${cc ? escapeHtml(cc.name) : 'None'}</span>`,
            `<span class="tag">Org: ${org ? escapeHtml(org.name) : 'None'}</span>`,
            `<span class="tag">Team: ${team ? escapeHtml(team.name) : 'None'}</span>`
        ].join('');

        if (editingUserId === u.id) {
            html += `<details class="user-panel" ${panelOpen ? 'open' : ''} ontoggle="setUserPanelOpen('${escapeInlineArg(u.id)}', this.open)">
                <summary class="user-panel-summary">
                    <div class="user-panel-summary-main">
                        <strong>${escapeHtml(u.name)}</strong>
                        <div class="help-text">Edit this user's assignment and license details.</div>
                    </div>
                    <div class="user-panel-summary-meta">${summaryMeta}</div>
                </summary>
                <form id="edit-${escapeHtml(u.id)}" class="user-panel-body" onsubmit="event.preventDefault(); saveUserEdit('${escapeInlineArg(u.id)}')">
                    <div class="form-row">
                        <div class="form-group">
                            <label>License</label>
                            <select data-field="license"><option value="business" ${u.license !== 'enterprise' ? 'selected' : ''}>Business</option><option value="enterprise" ${u.license === 'enterprise' ? 'selected' : ''}>Enterprise</option></select>
                        </div>
                        <div class="form-group">
                            <label>Cost Center</label>
                            <select data-field="cc"><option value="">(None)</option>${state.costCenters.map(c => optionHtml(c.id, c.name, u.costCenterId === c.id)).join('')}</select>
                        </div>
                        <div class="form-group">
                            <label>Organization</label>
                            <select data-field="org"><option value="">(None)</option>${state.orgs.map(o => optionHtml(o.id, o.name, u.orgId === o.id)).join('')}</select>
                        </div>
                        <div class="form-group">
                            <label>Team</label>
                            <select data-field="team"><option value="">(None)</option>${state.teams.map(t => optionHtml(t.id, t.name, u.teamId === t.id)).join('')}</select>
                        </div>
                    </div>
                    <div class="user-panel-grid" style="margin-top: 12px">
                        <div class="user-panel-field">
                            <div class="user-panel-field-label">Effective ULB</div>
                            <div class="user-panel-field-value">${ulb.value !== null ? formatBudgetDollarsFromCredits(ulb.value) + ` <small>(${escapeHtml(ulb.source)})</small>` : '∞'}</div>
                        </div>
                    </div>
                    <div class="user-panel-actions">
                        <button type="submit" class="btn-primary btn-sm">💾 Save</button>
                        <button type="button" class="btn-sm" onclick="editUser(null)">✕ Cancel</button>
                    </div>
                </form>
            </details>`;
        } else {
            html += `<details class="user-panel" ${panelOpen ? 'open' : ''} ontoggle="setUserPanelOpen('${escapeInlineArg(u.id)}', this.open)">
                <summary class="user-panel-summary">
                    <div class="user-panel-summary-main">
                        <strong>${escapeHtml(u.name)}</strong>
                        <div class="help-text">${ulb.value !== null ? `ULB: ${formatBudgetDollarsFromCredits(ulb.value)} via ${escapeHtml(ulb.source)}` : 'No user-level budget configured.'}</div>
                    </div>
                    <div class="user-panel-summary-meta">${summaryMeta}</div>
                </summary>
                <div class="user-panel-body">
                    <div class="user-panel-grid">
                        <div class="user-panel-field">
                            <div class="user-panel-field-label">License</div>
                            <div class="user-panel-field-value">${escapeHtml(u.license || 'business')}</div>
                        </div>
                        <div class="user-panel-field">
                            <div class="user-panel-field-label">Cost Center</div>
                            <div class="user-panel-field-value">${cc ? escapeHtml(cc.name) : '—'}</div>
                        </div>
                        <div class="user-panel-field">
                            <div class="user-panel-field-label">Organization</div>
                            <div class="user-panel-field-value">${org ? escapeHtml(org.name) : '—'}</div>
                        </div>
                        <div class="user-panel-field">
                            <div class="user-panel-field-label">Team</div>
                            <div class="user-panel-field-value">${team ? escapeHtml(team.name) : '—'}</div>
                        </div>
                        <div class="user-panel-field">
                            <div class="user-panel-field-label">Effective ULB</div>
                            <div class="user-panel-field-value">${ulb.value !== null ? formatBudgetDollarsFromCredits(ulb.value) + ` <small>(${escapeHtml(ulb.source)})</small>` : '∞'}</div>
                        </div>
                    </div>
                    <div class="user-panel-actions">
                        <button type="button" class="btn-sm" onclick="editUser('${escapeInlineArg(u.id)}')" title="Edit">✏️ Edit</button>
                        <button type="button" class="btn-danger btn-sm" onclick="deleteUser('${escapeInlineArg(u.id)}')">✕ Delete</button>
                    </div>
                </div>
            </details>`;
        }
    });
    html += '</div></div>';
    container.innerHTML = html;
}

// ─── Budgets Tab ─────────────────────────────────────────────────────────────
function updateBudgets() {
    const ulbVal = parseFloat(document.getElementById('universalULB').value);
    state.enterprise.universalULB = Number.isFinite(ulbVal) ? dollarsToCredits(ulbVal) : null;
    state.enterprise.enterpriseBudget = parseFloat(document.getElementById('enterpriseBudget').value) || 0;
    state.enterprise.enterpriseHardStop = document.getElementById('enterpriseHardStop').checked;
    saveState();
}

function setCostCenterBudgetsIndependent(value) {
    state.enterprise.costCenterBudgetsIndependent = !!value;
    document.querySelectorAll('[data-bind="costCenterBudgetsIndependent"]').forEach(checkbox => {
        checkbox.checked = !!state.enterprise.costCenterBudgetsIndependent;
    });
    saveState();
    renderGlobalBudgetSimulation();
}

function renderULBTargets() {
    const type = document.getElementById('ulbType').value;
    const sel = document.getElementById('ulbTarget');
    if (type === 'individual') {
        const usersWithoutULB = state.users.filter(u => u.individualULB === null);
        sel.innerHTML = usersWithoutULB.map(u => optionHtml(u.id, u.name)).join('');
    } else {
        const ccsWithoutULB = state.costCenters.filter(cc => cc.ulb === null);
        sel.innerHTML = ccsWithoutULB.map(cc => optionHtml(cc.id, cc.name)).join('');
    }
}

function addULB() {
    const type = document.getElementById('ulbType').value;
    const target = document.getElementById('ulbTarget').value;
    const valueDollars = parseFloat(document.getElementById('ulbValue').value);
    const value = Number.isFinite(valueDollars) ? dollarsToCredits(valueDollars) : NaN;
    if (!target) return alert('Select a target');
    if (isNaN(value) || value < 0) return alert('Enter a valid budget value');

    if (type === 'individual') {
        const user = state.users.find(u => u.id === target);
        if (user) user.individualULB = value;
    } else {
        const cc = state.costCenters.find(c => c.id === target);
        if (cc) cc.ulb = value;
    }
    document.getElementById('ulbValue').value = '';
    saveState();
    renderBudgets();
    renderUsers();
}

function removeULB(type, id) {
    if (type === 'individual') {
        const user = state.users.find(u => u.id === id);
        if (user) user.individualULB = null;
    } else {
        const cc = state.costCenters.find(c => c.id === id);
        if (cc) cc.ulb = null;
    }
    saveState();
    renderBudgets();
    renderUsers();
}

function renderOverageTargets() {
    const type = document.getElementById('overageBudgetType').value;
    const sel = document.getElementById('overageTarget');
    if (type === 'org') {
        const orgsWithoutBudget = state.orgs.filter(o => o.budget === null);
        sel.innerHTML = orgsWithoutBudget.map(o => optionHtml(o.id, o.name)).join('');
    } else {
        const ccsWithoutBudget = state.costCenters.filter(cc => cc.budget === null);
        sel.innerHTML = ccsWithoutBudget.map(cc => optionHtml(cc.id, cc.name)).join('');
    }
}

function addOverageBudget() {
    const type = document.getElementById('overageBudgetType').value;
    const target = document.getElementById('overageTarget').value;
    const value = parseFloat(document.getElementById('overageBudgetValue').value);
    const hardStop = document.getElementById('overageHardStop').checked;
    if (!target) return alert('Select a target');
    if (isNaN(value) || value < 0) return alert('Enter a valid budget value');

    if (type === 'org') {
        const org = state.orgs.find(o => o.id === target);
        if (org) { org.budget = value; org.budgetHardStop = hardStop; }
    } else {
        const cc = state.costCenters.find(c => c.id === target);
        if (cc) { cc.budget = value; cc.budgetHardStop = hardStop; }
    }
    document.getElementById('overageBudgetValue').value = '';
    saveState();
    renderBudgets();
}

function removeOverageBudget(type, id) {
    if (type === 'org') {
        const org = state.orgs.find(o => o.id === id);
        if (org) { org.budget = null; org.budgetHardStop = true; }
    } else {
        const cc = state.costCenters.find(c => c.id === id);
        if (cc) { cc.budget = null; cc.budgetHardStop = true; }
    }
    saveState();
    renderBudgets();
}

function updateConfiguredULB(type, id, value) {
    const parsed = parseFloat(value);
    if (value !== '' && !Number.isFinite(parsed)) return;
    const nextValue = value === '' ? null : dollarsToCredits(parsed);
    if (type === 'individual') {
        const user = state.users.find(u => u.id === id);
        if (user) user.individualULB = nextValue;
    } else {
        const cc = state.costCenters.find(c => c.id === id);
        if (cc) cc.ulb = nextValue;
    }
    saveState();
    renderUsers();
}

function updateConfiguredOverage(type, id, field, value) {
    if (type === 'org') {
        const org = state.orgs.find(o => o.id === id);
        if (!org) return;
        if (field === 'budget') org.budget = value === '' ? null : parseFloat(value);
        else if (field === 'hardStop') org.budgetHardStop = value;
    } else {
        const cc = state.costCenters.find(c => c.id === id);
        if (!cc) return;
        if (field === 'budget') cc.budget = value === '' ? null : parseFloat(value);
        else if (field === 'hardStop') cc.budgetHardStop = value;
    }
    saveState();
}

function renderBudgets() {
    // Universal ULB
    document.getElementById('universalULB').value = state.enterprise.universalULB !== null ? creditsToDollars(state.enterprise.universalULB).toFixed(2) : '';
    document.getElementById('enterpriseBudget').value = state.enterprise.enterpriseBudget;
    document.getElementById('enterpriseHardStop').checked = state.enterprise.enterpriseHardStop;
    document.querySelectorAll('[data-bind="costCenterBudgetsIndependent"]').forEach(checkbox => {
        checkbox.checked = !!state.enterprise.costCenterBudgetsIndependent;
    });

    // Refresh target dropdowns
    renderULBTargets();
    renderOverageTargets();

    // Configured ULBs table
    const ulbEl = document.getElementById('configuredULBList');
    const configuredIndividualULBs = state.users.filter(u => u.individualULB !== null);
    const configuredCCULBs = state.costCenters.filter(cc => cc.ulb !== null);

    if (configuredIndividualULBs.length === 0 && configuredCCULBs.length === 0) {
        ulbEl.innerHTML = '<p class="help-text">No user-level budgets configured yet. Use the form above to add one.</p>';
    } else {
        let html = '<table><thead><tr><th>Type</th><th>Target</th><th>Budget ($)</th><th></th></tr></thead><tbody>';
        configuredCCULBs.forEach(cc => {
            html += `<tr>
                <td><span class="badge badge-info">Cost Center</span></td>
                <td>${escapeHtml(cc.name)}</td>
                <td><input type="number" value="${creditsToDollars(cc.ulb).toFixed(2)}" min="0" step="0.01" style="width:120px" onchange="updateConfiguredULB('costcenter','${escapeInlineArg(cc.id)}',this.value)"></td>
                <td><button class="btn-danger btn-sm" onclick="removeULB('costcenter','${escapeInlineArg(cc.id)}')">✕</button></td>
            </tr>`;
        });
        configuredIndividualULBs.forEach(u => {
            html += `<tr>
                <td><span class="badge badge-warning">Individual</span></td>
                <td>${escapeHtml(u.name)}</td>
                <td><input type="number" value="${creditsToDollars(u.individualULB).toFixed(2)}" min="0" step="0.01" style="width:120px" onchange="updateConfiguredULB('individual','${escapeInlineArg(u.id)}',this.value)"></td>
                <td><button class="btn-danger btn-sm" onclick="removeULB('individual','${escapeInlineArg(u.id)}')">✕</button></td>
            </tr>`;
        });
        html += '</tbody></table>';
        ulbEl.innerHTML = html;
    }

    // Configured Overage Budgets table
    const overageEl = document.getElementById('configuredOverageBudgetList');
    const configuredOrgBudgets = state.orgs.filter(o => o.budget !== null);
    const configuredCCBudgets = state.costCenters.filter(cc => cc.budget !== null);

    if (configuredOrgBudgets.length === 0 && configuredCCBudgets.length === 0) {
        overageEl.innerHTML = '<p class="help-text">No overage budgets configured yet. Use the form above to add one.</p>';
    } else {
        let html = '<table><thead><tr><th>Type</th><th>Target</th><th>Budget ($)</th><th>Hard Stop</th><th></th></tr></thead><tbody>';
        configuredOrgBudgets.forEach(o => {
            html += `<tr>
                <td><span class="badge badge-info">Organization</span></td>
                <td>${escapeHtml(o.name)}</td>
                <td><input type="number" value="${o.budget}" min="0" step="50" style="width:120px" onchange="updateConfiguredOverage('org','${escapeInlineArg(o.id)}','budget',this.value)"></td>
                <td><label class="checkbox-label"><input type="checkbox" ${o.budgetHardStop !== false ? 'checked' : ''} onchange="updateConfiguredOverage('org','${escapeInlineArg(o.id)}','hardStop',this.checked)"> Yes</label></td>
                <td><button class="btn-danger btn-sm" onclick="removeOverageBudget('org','${escapeInlineArg(o.id)}')">✕</button></td>
            </tr>`;
        });
        configuredCCBudgets.forEach(cc => {
            html += `<tr>
                <td><span class="badge badge-warning">Cost Center</span></td>
                <td>${escapeHtml(cc.name)}</td>
                <td><input type="number" value="${cc.budget}" min="0" step="50" style="width:120px" onchange="updateConfiguredOverage('costcenter','${escapeInlineArg(cc.id)}','budget',this.value)"></td>
                <td><label class="checkbox-label"><input type="checkbox" ${cc.budgetHardStop !== false ? 'checked' : ''} onchange="updateConfiguredOverage('costcenter','${escapeInlineArg(cc.id)}','hardStop',this.checked)"> Yes</label></td>
                <td><button class="btn-danger btn-sm" onclick="removeOverageBudget('costcenter','${escapeInlineArg(cc.id)}')">✕</button></td>
            </tr>`;
        });
        html += '</tbody></table>';
        overageEl.innerHTML = html;
    }
}

// ─── Pool Visualization ──────────────────────────────────────────────────────
function renderPoolView() {
    const container = document.getElementById('poolVisualization');
    const pool = totalPool();
    if (pool === 0) {
        container.innerHTML = '<div class="empty-state"><p>Configure enterprise seats first.</p></div>';
        return;
    }

    const colors = ['#1f6feb', '#238636', '#a371f7', '#d29922', '#f85149', '#58a6ff', '#3fb950', '#db61a2'];
    const segments = [];
    let reserved = 0;

    state.costCenters.forEach((cc, i) => {
        if (!cc.poolEnabled) return;
        const size = getCCPoolSize(cc);
        if (size === 0) return;
        reserved += size;
        segments.push({ label: cc.name, size, color: colors[i % colors.length] });
    });

    const unreserved = pool - reserved;

    let barHtml = '<div class="pool-bar">';
    segments.forEach(seg => {
        const pct = (seg.size / pool * 100).toFixed(1);
        barHtml += `<div class="pool-segment" style="width:${pct}%; background:${seg.color}" title="${escapeHtml(`${seg.label}: ${fmt(seg.size)} credits (${pct}%)`)}">${pct > 8 ? escapeHtml(seg.label) : ''}</div>`;
    });
    if (unreserved > 0) {
        const pct = (unreserved / pool * 100).toFixed(1);
        barHtml += `<div class="pool-segment" style="width:${pct}%; background:var(--color-text-muted)" title="Unreserved: ${fmt(unreserved)} credits (${pct}%)">${pct > 8 ? 'Unreserved' : ''}</div>`;
    }
    barHtml += '</div>';

    let legendHtml = '<div class="pool-legend">';
    segments.forEach(seg => {
        legendHtml += `<div class="pool-legend-item"><div class="pool-legend-swatch" style="background:${seg.color}"></div>${escapeHtml(seg.label)}: ${fmt(seg.size)}</div>`;
    });
    legendHtml += `<div class="pool-legend-item"><div class="pool-legend-swatch" style="background:var(--color-text-muted)"></div>Unreserved: ${fmt(unreserved)}</div>`;
    legendHtml += '</div>';

    const detailsHtml = `<table style="margin-top: 16px">
        <thead><tr><th>Cost Center</th><th>Pool</th><th>Members</th><th>Pool Size</th><th>% of Total</th></tr></thead>
        <tbody>
            ${state.costCenters.map(cc => `<tr>
                <td>${escapeHtml(cc.name)}</td>
                <td>${cc.poolEnabled ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-warning">Inactive</span>'}</td>
                <td>${getAssignedCCMembers(cc).length}</td>
                <td>${fmt(getCCPoolSize(cc))}</td>
                <td>${pool > 0 ? (getCCPoolSize(cc) / pool * 100).toFixed(1) : 0}%</td>
            </tr>`).join('')}
            <tr style="font-weight:600">
                <td>Unreserved</td><td></td>
                <td>${state.users.filter(u => !getUserCC(u)).length}</td>
                <td>${fmt(unreserved)}</td>
                <td>${pool > 0 ? (unreserved / pool * 100).toFixed(1) : 0}%</td>
            </tr>
        </tbody>
    </table>`;

    container.innerHTML = barHtml + legendHtml + detailsHtml;
}

function orgMapUsageNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function emptyOrgMapUsageTotals(capacity = {}) {
    return {
        creditsRequested: 0,
        creditsConsumed: 0,
        creditsBlocked: 0,
        poolCredits: 0,
        meteredCredits: 0,
        meteredCost: 0,
        capacity: { ...capacity }
    };
}

function addOrgMapUsageResult(totals, result) {
    if (!totals || !result || typeof result !== 'object') return;
    const requested = orgMapUsageNumber(result.usage);
    const ccCredits = orgMapUsageNumber(result.creditsFromCC);
    const enterpriseCredits = orgMapUsageNumber(result.creditsFromEntPool);
    const meteredCredits = orgMapUsageNumber(result.creditsMetered);
    const consumed = Math.min(requested, ccCredits + enterpriseCredits + meteredCredits);

    totals.creditsRequested += requested;
    totals.creditsConsumed += consumed;
    totals.creditsBlocked += Math.max(0, requested - consumed);
    totals.poolCredits += ccCredits + enterpriseCredits;
    totals.meteredCredits += meteredCredits;
    totals.meteredCost += orgMapUsageNumber(result.meteredCost);
}

function buildOrgMapUsage(model) {
    const usage = {
        enterprise: emptyOrgMapUsageTotals(),
        costCenters: {},
        groups: {},
        users: {},
        budgets: { enterprise: null, costCenters: {}, organizations: {} },
        poolState: null
    };

    const users = Array.isArray(state.users) ? state.users : [];
        const mapModel = model && typeof model === 'object' ? model : null;
        const costCenters = Array.isArray(mapModel?.costCenters) ? mapModel.costCenters : [];
        const initialPool = initPoolState();

        usage.enterprise = emptyOrgMapUsageTotals({
            seats: orgMapUsageNumber(mapModel?.totalSeats),
            poolCredits: orgMapUsageNumber(mapModel?.totalPool),
            enterprisePoolCredits: orgMapUsageNumber(initialPool?.enterprisePool)
        });

        costCenters.forEach(cc => {
            const ccKey = `cost-center:${String(cc.id)}`;
            usage.costCenters[ccKey] = emptyOrgMapUsageTotals({
                seats: orgMapUsageNumber(cc.memberCount),
                poolCredits: orgMapUsageNumber(cc.poolSize),
                ulbCredits: cc.ulb === null || cc.ulb === undefined ? null : orgMapUsageNumber(cc.ulb),
                overageBudget: cc.budget === null || cc.budget === undefined
                    ? null : orgMapUsageNumber(cc.budget)
            });
            (Array.isArray(cc.groups) ? cc.groups : []).forEach(group => {
                const groupKey = `${ccKey}/${group.type}:${String(group.id)}`;
                const aggregateUsers = Array.isArray(group.aggregateUsers) ? group.aggregateUsers : group.users;
                const orgBudget = group.type === 'organization'
                    ? (Array.isArray(state.orgs) ? state.orgs : []).find(org => org.id === group.id)?.budget
                    : null;
                usage.groups[groupKey] = emptyOrgMapUsageTotals({
                    users: Array.isArray(aggregateUsers) ? aggregateUsers.length : 0,
                    overageBudget: orgBudget === null || orgBudget === undefined
                        ? null : orgMapUsageNumber(orgBudget)
                });
            });
        });

        users.forEach(user => {
            const ulb = getEffectiveULB(user);
            usage.users[`user:${String(user.id)}`] = {
                ...emptyOrgMapUsageTotals({
                    ulbCredits: ulb && ulb.value !== null ? orgMapUsageNumber(ulb.value) : null
                }),
                ulb: {
                    limit: ulb && ulb.value !== null ? orgMapUsageNumber(ulb.value) : null,
                    source: ulb?.source || null,
                    consumed: 0
                }
            };
        });

        if (users.length === 0) return usage;

        const simulation = computeSimulationResults({ ignoreSavedLastCalls: true });
        const results = Array.isArray(simulation?.results) ? simulation.results : [];
        const resultsByUser = new Map(results.filter(Boolean).map(result => [result.userId, result]));

        costCenters.forEach(cc => {
            const ccKey = `cost-center:${String(cc.id)}`;
            const ccTotals = usage.costCenters[ccKey];
            (Array.isArray(cc.groups) ? cc.groups : []).forEach(group => {
                const groupTotals = usage.groups[`${ccKey}/${group.type}:${String(group.id)}`];
                (Array.isArray(group.aggregateUsers) ? group.aggregateUsers : (Array.isArray(group.users) ? group.users : [])).forEach(user => {
                    const result = resultsByUser.get(user.id);
                    addOrgMapUsageResult(groupTotals, result);
                });
                (Array.isArray(group.users) ? group.users : []).forEach(user => {
                    const result = resultsByUser.get(user.id);
                    addOrgMapUsageResult(ccTotals, result);
                });
            });
        });

        results.forEach(result => {
            addOrgMapUsageResult(usage.enterprise, result);
            const userTotals = usage.users[`user:${String(result?.userId)}`];
            addOrgMapUsageResult(userTotals, result);
            if (userTotals) userTotals.ulb.consumed = userTotals.creditsConsumed;
        });

        const finalPool = simulation?.poolState || {};
        usage.poolState = {
            enterpriseRemaining: orgMapUsageNumber(finalPool.enterprisePool),
            costCenterRemaining: { ...(finalPool.ccPools || {}) }
        };
        const enterprise = state.enterprise && typeof state.enterprise === 'object' ? state.enterprise : {};
        usage.budgets.enterprise = {
            limit: enterprise.enterpriseBudget === null || enterprise.enterpriseBudget === undefined
                ? null : orgMapUsageNumber(enterprise.enterpriseBudget),
            consumed: orgMapUsageNumber(finalPool.enterpriseMetered),
            hardStop: enterprise.enterpriseHardStop === true
        };
        (Array.isArray(state.costCenters) ? state.costCenters : []).forEach(cc => {
            usage.budgets.costCenters[`cost-center:${String(cc.id)}`] = {
                limit: cc.budget === null || cc.budget === undefined ? null : orgMapUsageNumber(cc.budget),
                consumed: orgMapUsageNumber(finalPool.ccMetered?.[cc.id]),
                hardStop: cc.budgetHardStop === true
            };
        });
        (Array.isArray(state.orgs) ? state.orgs : []).forEach(org => {
            usage.budgets.organizations[`organization:${String(org.id)}`] = {
                limit: org.budget === null || org.budget === undefined ? null : orgMapUsageNumber(org.budget),
                consumed: orgMapUsageNumber(finalPool.orgMetered?.[org.id]),
                hardStop: org.budgetHardStop === true
            };
        });
    return usage;
}

const ORG_MAP_USER_COLLAPSE_THRESHOLD = 8;
const orgMapExpandedUserGroups = new Set();

function orgMapUsageForNode(usage, node, context = {}) {
    if (node.type === 'enterprise') return usage.enterprise;
    if (node.type === 'cost-center') return usage.costCenters[`cost-center:${String(node.id)}`];
    if (node.type === 'team' || node.type === 'organization' || node.type === 'direct') {
        return usage.groups[`cost-center:${String(context.costCenter.id)}/${node.type}:${String(node.id)}`];
    }
    return usage.users[`user:${String(node.id)}`];
}

function orgMapBudgetAmount(budget) {
    if (budget.kind === 'ulb') return formatBudgetWithCreditReferenceFromCredits(budget.amount);
    if (budget.kind === 'overage') return `$${Math.max(0, budget.amount).toFixed(2)}`;
    return `${fmt(Math.round(Math.max(0, budget.amount)))} credits`;
}

let orgMapBudgetInfoReturnFocus = null;
let orgMapBudgetInfoInertElements = [];

function findOrgMapBudgetDescriptor(budgetId, model) {
    const candidates = [{ node: model, context: { enterprise: model } }];
    model.costCenters.forEach(costCenter => {
        const costCenterContext = { enterprise: model, costCenter };
        candidates.push({ node: costCenter, context: costCenterContext });
        costCenter.groups.forEach(group => {
            const groupContext = {
                ...costCenterContext,
                organization: group.type === 'organization' ? group : null
            };
            candidates.push({ node: group, context: groupContext });
            group.users.forEach(user => candidates.push({ node: user, context: groupContext }));
        });
    });

    for (const candidate of candidates) {
        const budgets = collectOrgMapBudgets(candidate.node, candidate.context);
        const descriptor = budgets.find(budget => budget.id === budgetId);
        if (descriptor) {
            return {
                ...candidate,
                descriptor,
                shadowedBy: descriptor.shadowedBy
                    ? budgets.find(budget => budget.id === descriptor.shadowedBy) || null
                    : null
            };
        }
    }
    return null;
}

function orgMapBudgetSourceId(descriptor) {
    const parts = String(descriptor.id).split(':');
    return parts.length > 3 ? decodeURIComponent(parts[3]) : null;
}

function orgMapBudgetLiveUsage(match, usage) {
    const { descriptor, node, context } = match;
    const sourceId = orgMapBudgetSourceId(descriptor);
    let consumed = 0;
    let remaining = null;
    let perUserOnly = false;

    if (descriptor.kind === 'overage') {
        let budgetUsage = null;
        if (descriptor.level === 'enterprise') budgetUsage = usage.budgets.enterprise;
        else if (descriptor.level === 'cost-center') {
            budgetUsage = usage.budgets.costCenters[`cost-center:${sourceId}`];
        } else if (descriptor.level === 'organization') {
            budgetUsage = usage.budgets.organizations[`organization:${sourceId}`];
        }
        consumed = orgMapUsageNumber(budgetUsage?.consumed);
    } else if (descriptor.kind === 'pool') {
        const poolRemaining = usage.poolState?.costCenterRemaining?.[sourceId];
        if (Number.isFinite(Number(poolRemaining))) {
            remaining = orgMapUsageNumber(poolRemaining);
            consumed = Math.max(0, descriptor.amount - remaining);
        }
    } else {
        const nodeIsUser = node.type !== 'enterprise' &&
            node.type !== 'cost-center' &&
            node.type !== 'organization' &&
            node.type !== 'team' &&
            node.type !== 'direct';
        if (nodeIsUser) {
            consumed = orgMapUsageNumber(usage.users[`user:${String(node.id)}`]?.ulb?.consumed);
        } else {
            perUserOnly = true;
            consumed = null;
        }
    }

    if (!perUserOnly && remaining === null) remaining = Math.max(0, descriptor.amount - consumed);
    const percentage = !perUserOnly && descriptor.amount > 0 ? (consumed / descriptor.amount) * 100 : null;
    return { consumed, remaining, percentage, perUserOnly };
}

function closeOrgMapBudgetInfo() {
    const overlay = document.getElementById('orgMapBudgetInfoOverlay');
    if (!overlay) return;
    overlay.remove();
    orgMapBudgetInfoInertElements.forEach(({ element, wasInert }) => {
        if (element.isConnected) element.inert = wasInert;
    });
    orgMapBudgetInfoInertElements = [];
    if (orgMapBudgetInfoReturnFocus?.isConnected) orgMapBudgetInfoReturnFocus.focus();
    orgMapBudgetInfoReturnFocus = null;
}

function showOrgMapBudgetInfo(budgetId) {
    const model = buildOrgMapModel();
    const match = findOrgMapBudgetDescriptor(budgetId, model);
    if (!match) {
        console.warn(`Org Map budget descriptor not found: ${String(budgetId)}`);
        return;
    }

    const usage = buildOrgMapUsage(model);
    const { descriptor, shadowedBy } = match;
    const live = orgMapBudgetLiveUsage(match, usage);
    const configuredAmount = descriptor.amountUnit === 'dollars'
        ? formatBudgetWithCreditReferenceFromDollars(descriptor.amount)
        : formatBudgetWithCreditReferenceFromCredits(descriptor.amount);
    const formatLiveAmount = descriptor.amountUnit === 'dollars'
        ? value => value === null ? 'Per-user limit — inspect individual users' : `$${value.toFixed(2)}`
        : value => value === null ? 'Per-user limit — inspect individual users' : `${fmt(Math.round(value))} AI credits`;
    const kindLabels = { ulb: 'User-level budget (ULB)', overage: 'Overage budget', pool: 'Reserved pool' };
    const status = descriptor.effective
        ? (descriptor.inherited ? 'Effective and inherited' : 'Effective at this scope')
        : `Shadowed${shadowedBy ? ` by ${shadowedBy.title}` : ' by a higher-precedence budget'}${descriptor.inherited ? ' (inherited)' : ''}`;
    const enforcement = descriptor.hardStop
        ? 'Hard stop — usage is blocked when the available budget is exhausted.'
        : 'Soft behavior — usage may continue through available fallback or metered routing.';

    closeOrgMapBudgetInfo();
    orgMapBudgetInfoReturnFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.id = 'orgMapBudgetInfoOverlay';
    overlay.className = 'orgmap-budget-dialog-backdrop';
    overlay.innerHTML = `<section class="orgmap-budget-dialog" role="dialog" aria-modal="true" aria-labelledby="orgMapBudgetInfoTitle">
        <header class="orgmap-budget-dialog-header">
            <h2 id="orgMapBudgetInfoTitle" class="orgmap-budget-dialog-title">${escapeHtml(descriptor.title)}</h2>
            <button type="button" class="orgmap-budget-dialog-close" aria-label="Close budget details" onclick="closeOrgMapBudgetInfo()">×</button>
        </header>
        <div class="orgmap-budget-dialog-body">
            <dl style="display:grid;grid-template-columns:max-content 1fr;gap:8px 16px;margin:0 0 20px">
                <dt>Budget type</dt><dd>${escapeHtml(kindLabels[descriptor.kind] || descriptor.kind)}</dd>
                <dt>Source</dt><dd>${escapeHtml(`${descriptor.level}: ${descriptor.sourceName}`)}</dd>
                <dt>Configured amount</dt><dd>${escapeHtml(configuredAmount)}</dd>
                <dt>Status</dt><dd>${escapeHtml(status)}</dd>
                <dt>Enforcement</dt><dd>${escapeHtml(enforcement)}</dd>
                <dt>Consumed</dt><dd>${escapeHtml(formatLiveAmount(live.consumed))}</dd>
                <dt>Remaining</dt><dd>${escapeHtml(formatLiveAmount(live.remaining))}</dd>
                <dt>Used</dt><dd>${escapeHtml(live.percentage === null ? 'Calculated per user' : `${live.percentage.toFixed(1)}%`)}</dd>
            </dl>
            <h3 style="margin-bottom:6px">Why it applies</h3>
            <p>${escapeHtml(descriptor.rule)}</p>
        </div>
    </section>`;
    document.body.appendChild(overlay);
    orgMapBudgetInfoInertElements = [...document.body.children]
        .filter(element => element !== overlay)
        .map(element => ({ element, wasInert: element.inert }));
    orgMapBudgetInfoInertElements.forEach(({ element }) => { element.inert = true; });
    overlay.querySelector('.orgmap-budget-dialog-close').focus();
}

document.addEventListener('click', event => {
    if (event.target === document.getElementById('orgMapBudgetInfoOverlay')) closeOrgMapBudgetInfo();
});

document.addEventListener('keydown', event => {
    const overlay = document.getElementById('orgMapBudgetInfoOverlay');
    if (event.key === 'Escape' && overlay) {
        closeOrgMapBudgetInfo();
    } else if (event.key === 'Tab' && overlay) {
        const focusable = [...overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter(element => !element.disabled && element.getAttribute('aria-hidden') !== 'true');
        if (focusable.length === 0) {
            event.preventDefault();
            overlay.querySelector('[role="dialog"]')?.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if ((event.shiftKey && document.activeElement === first) ||
            (!event.shiftKey && document.activeElement === last)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
        }
    }
});

function renderOrgMapBudgetBadge(budget) {
    const classes = [
        'orgmap-budget-badge',
        `orgmap-budget-${budget.kind}`,
        budget.effective ? 'orgmap-budget-effective' : 'orgmap-budget-shadowed',
        budget.inherited ? 'orgmap-budget-inherited' : ''
    ].filter(Boolean).join(' ');
    const status = budget.effective ? 'effective' : 'shadowed';
    const inherited = budget.inherited ? ', inherited' : '';
    const label = `${budget.title}: ${orgMapBudgetAmount(budget)}, ${status}${inherited}`;
    return `<span class="${classes}" data-budget-kind="${escapeHtml(budget.kind)}" data-budget-id="${escapeHtml(budget.id)}">
        <span class="orgmap-budget-label">${escapeHtml(budget.kind.toUpperCase())}</span>
        <span class="orgmap-budget-amount">${escapeHtml(orgMapBudgetAmount(budget))}</span>
        <button type="button" class="orgmap-budget-info" aria-label="${escapeHtml(`Budget details for ${label}`)}" title="${escapeHtml(budget.rule)}" onclick="if(typeof showOrgMapBudgetInfo==='function')showOrgMapBudgetInfo('${escapeInlineArg(budget.id)}')">i</button>
    </span>`;
}

function renderOrgMapBudgets(node, context) {
    const budgets = collectOrgMapBudgets(node, context);
    if (budgets.length === 0) return '';
    return `<div class="orgmap-budgets" aria-label="Budgets">${budgets.map(renderOrgMapBudgetBadge).join('')}</div>`;
}

function orgMapUsageCapacity(node, totals, budgets) {
    const nodeIsUser = node.type !== 'enterprise' &&
        node.type !== 'cost-center' &&
        node.type !== 'organization' &&
        node.type !== 'team' &&
        node.type !== 'direct';
    if (nodeIsUser) {
        const effectiveULB = budgets.find(budget => budget.effective && budget.kind === 'ulb');
        if (effectiveULB) return effectiveULB.amount;
    }
    const effectivePool = budgets.find(budget => budget.effective && budget.kind === 'pool');
    if (effectivePool) return effectivePool.amount;
    if (node.type === 'enterprise') return node.totalPool;
    if (totals?.capacity?.poolCredits) return totals.capacity.poolCredits;
    return node.creditsPerSeat || 0;
}

function renderOrgMapUsageBar(node, usage, context) {
    const totals = orgMapUsageForNode(usage, node, context) || emptyOrgMapUsageTotals();
    const budgets = collectOrgMapBudgets(node, context);
    const capacity = orgMapUsageCapacity(node, totals, budgets);
    const consumed = orgMapUsageNumber(totals.creditsConsumed);
    const requested = orgMapUsageNumber(totals.creditsRequested);
    const percent = capacity > 0 ? (consumed / capacity) * 100 : 0;
    const width = Math.min(100, Math.max(0, percent));
    const label = capacity > 0
        ? `${fmt(Math.round(consumed))} of ${fmt(Math.round(capacity))} credits consumed (${percent.toFixed(1)}%)`
        : consumed > 0
            ? `${fmt(Math.round(consumed))} credits consumed (no fixed pool or ULB capacity)`
            : `${fmt(Math.round(requested))} credits requested; no applicable capacity`;
    const progressMaximum = Math.max(1, Math.round(capacity), Math.round(consumed));
    return `<div class="orgmap-usage" aria-label="${escapeHtml(label)}">
        <div class="orgmap-usage-track" role="progressbar" aria-label="Credit usage" aria-valuemin="0" aria-valuemax="${escapeHtml(progressMaximum)}" aria-valuenow="${escapeHtml(Math.round(consumed))}">
            <span class="orgmap-usage-fill" style="width:${width.toFixed(1)}%"></span>
        </div>
        <span class="orgmap-usage-label">${escapeHtml(label)}</span>
    </div>`;
}

function renderOrgMapMembershipTags(user) {
    const tags = [];
    (user.memberships?.teams || []).forEach(team => {
        if (user.groupedBy.type !== 'team' || team.id !== user.groupedBy.id) {
            tags.push({ type: 'team', id: team.id, name: team.name });
        }
    });
    (user.memberships?.organizations || []).forEach(org => {
        if (user.groupedBy.type !== 'organization' || org.id !== user.groupedBy.id) {
            tags.push({ type: 'organization', id: org.id, name: org.name });
        }
    });
    if (tags.length === 0) return '';
    return `<div class="orgmap-memberships" aria-label="Alternate memberships">${tags.map(tag =>
        `<span class="orgmap-membership-tag orgmap-membership-${tag.type}" data-orgmap-type="${tag.type}" data-orgmap-id="${escapeHtml(tag.id)}">${escapeHtml(tag.name)}</span>`
    ).join('')}</div>`;
}

function renderOrgMapUser(user, model, costCenter, group, usage) {
    const context = { enterprise: model, costCenter, organization: group.type === 'organization' ? group : null };
    return `<article class="orgmap-user-chip" data-orgmap-type="user" data-orgmap-id="${escapeHtml(user.id)}" aria-label="${escapeHtml(`User ${user.name}`)}">
        <div class="orgmap-user-heading">
            <strong class="orgmap-user-name">${escapeHtml(user.name)}</strong>
            <span class="orgmap-user-license">${escapeHtml(user.license || 'business')}</span>
        </div>
        ${renderOrgMapMembershipTags(user)}
        ${renderOrgMapBudgets(user, context)}
        ${renderOrgMapUsageBar(user, usage, context)}
    </article>`;
}

function orgMapGroupKey(costCenter, group) {
    return `cost-center:${String(costCenter.id)}/${group.type}:${String(group.id)}`;
}

function renderOrgMapGroup(group, model, costCenter, usage) {
    const key = orgMapGroupKey(costCenter, group);
    const users = Array.isArray(group.users) ? group.users : [];
    const memberCount = Number.isFinite(Number(group.memberCount)) ? Number(group.memberCount) : users.length;
    const collapsible = users.length > ORG_MAP_USER_COLLAPSE_THRESHOLD;
    const expanded = orgMapExpandedUserGroups.has(key);
    const visibleUsers = collapsible && !expanded ? users.slice(0, ORG_MAP_USER_COLLAPSE_THRESHOLD) : users;
    const context = { enterprise: model, costCenter, organization: group.type === 'organization' ? group : null };
    const hiddenCount = users.length - visibleUsers.length;
    const toggle = collapsible
        ? `<button type="button" class="orgmap-users-toggle" aria-expanded="${expanded}" onclick="toggleOrgMapUsers('${escapeInlineArg(key)}')">${expanded ? 'Show fewer users' : `Show ${hiddenCount} more users`}</button>`
        : '';
    return `<section class="orgmap-group-box orgmap-group-${group.type}" data-orgmap-type="${escapeHtml(group.type)}" data-orgmap-id="${escapeHtml(group.id)}" aria-label="${escapeHtml(`${group.name}, ${memberCount} users`)}">
        <header class="orgmap-group-header">
            <h4 class="orgmap-group-title">${escapeHtml(group.name)}</h4>
            <span class="orgmap-user-count">${escapeHtml(memberCount)} user${memberCount === 1 ? '' : 's'}</span>
        </header>
        ${renderOrgMapBudgets(group, context)}
        ${renderOrgMapUsageBar(group, usage, context)}
        <div class="orgmap-users">${visibleUsers.length > 0
            ? visibleUsers.map(user => renderOrgMapUser(user, model, costCenter, group, usage)).join('')
            : '<p class="orgmap-group-empty">No users in this group.</p>'}</div>
        ${toggle}
    </section>`;
}

function renderOrgMapCostCenter(costCenter, model, usage) {
    const context = { enterprise: model, costCenter };
    const groups = (costCenter.groups || []).filter(group => group.type !== 'direct' || group.users.length > 0);
    return `<section class="orgmap-cost-center-box${costCenter.isUnassigned ? ' orgmap-cost-center-unassigned' : ''}" data-orgmap-type="cost-center" data-orgmap-id="${escapeHtml(costCenter.id)}" aria-label="${escapeHtml(`Cost center ${costCenter.name}`)}">
        <header class="orgmap-cost-center-header">
            <h3 class="orgmap-cost-center-title">${escapeHtml(costCenter.name)}</h3>
            <span class="orgmap-user-count">${escapeHtml(costCenter.memberCount)} member${costCenter.memberCount === 1 ? '' : 's'}</span>
        </header>
        ${renderOrgMapBudgets(costCenter, context)}
        ${renderOrgMapUsageBar(costCenter, usage, context)}
        <div class="orgmap-groups">${groups.length > 0
            ? groups.map(group => renderOrgMapGroup(group, model, costCenter, usage)).join('')
            : '<p class="orgmap-cost-center-empty">No teams, organizations, or direct users.</p>'}</div>
    </section>`;
}

function toggleOrgMapUsers(key) {
    if (orgMapExpandedUserGroups.has(key)) orgMapExpandedUserGroups.delete(key);
    else orgMapExpandedUserGroups.add(key);
    renderOrgMap();
}

function renderOrgMap() {
    const canvas = document.getElementById('orgMapCanvas');
    if (!canvas) return;
    const model = buildOrgMapModel();
    const usage = buildOrgMapUsage(model);
    const hasMapContent = model.costCenters.length > 0;
    if (!hasMapContent) {
        canvas.innerHTML = '<div class="orgmap-empty-state" data-orgmap-type="empty" role="status"><h3>No organization data yet</h3><p>Add cost centers, teams, organizations, or users to build the map.</p></div>';
        return;
    }
    canvas.innerHTML = `<section class="orgmap-enterprise-box" data-orgmap-type="enterprise" data-orgmap-id="${escapeHtml(model.id)}" aria-label="${escapeHtml(`Enterprise ${model.name}`)}">
        <header class="orgmap-enterprise-header">
            <h2 class="orgmap-enterprise-title">${escapeHtml(model.name)}</h2>
            <span class="orgmap-user-count">${escapeHtml(model.userCount)} user${model.userCount === 1 ? '' : 's'}</span>
        </header>
        ${renderOrgMapBudgets(model, { enterprise: model })}
        ${renderOrgMapUsageBar(model, usage, { enterprise: model })}
        <div class="orgmap-cost-centers">${model.costCenters.map(costCenter =>
            renderOrgMapCostCenter(costCenter, model, usage)).join('')}</div>
    </section>`;
}

// ─── Simulation Engine ───────────────────────────────────────────────────────
function initPoolState() {
    const pool = totalPool();
    const ccPools = {};
    let totalReserved = 0;
    state.costCenters.forEach(cc => {
        if (cc.poolEnabled) {
            const size = getCCPoolSize(cc);
            ccPools[cc.id] = size;
            totalReserved += size;
        }
    });
    return { ccPools, enterprisePool: pool - totalReserved, enterpriseMetered: 0, ccMetered: {}, orgMetered: {} };
}

function getUserCC(user) {
    if (user.costCenterId) return state.costCenters.find(c => c.id === user.costCenterId) || null;
    // Check if user is in a team that's assigned to a CC
    if (user.teamId) {
        const cc = state.costCenters.find(c => {
            const tids = c.teamIds || (c.teamId ? [c.teamId] : []);
            return tids.includes(user.teamId);
        });
        if (cc) return cc;
    }
    // Check if user is in an org assigned to a CC
    if (user.orgId) {
        const cc = state.costCenters.find(c => c.orgIds && c.orgIds.includes(user.orgId));
        if (cc) return cc;
    }
    // Check if user is directly listed in a CC's userIds
    const cc = state.costCenters.find(c => c.userIds && c.userIds.includes(user.id));
    if (cc) return cc;
    return null;
}

function userHasIndependentCostCenterBudget(user, cc = getUserCC(user)) {
    return !!(state.enterprise.costCenterBudgetsIndependent
        && cc
        && cc.overagesAllowed
        && cc.budget !== null
        && cc.budget !== undefined);
}

function getMeteredBudgetLabels(user) {
    const labels = [];
    const cc = getUserCC(user);
    const hasIndependentCostCenterBudget = userHasIndependentCostCenterBudget(user, cc);
    if (cc && cc.budget !== null && cc.budget !== undefined) {
        labels.push(`${cc.name} Cost Center Overage Budget`);
    }
    const org = user.orgId ? state.orgs.find(o => o.id === user.orgId) : null;
    if (org && org.budget !== null && org.budget !== undefined) {
        labels.push(`${org.name} Organization Overage Budget`);
    }
    if (!hasIndependentCostCenterBudget
        && state.enterprise.enterpriseBudget !== null
        && state.enterprise.enterpriseBudget !== undefined) {
        labels.push('Enterprise Overage Budget');
    }
    return labels;
}

function formatMeteredBudgetContext(labels) {
    return labels.length > 0
        ? ` via ${labels.join(' + ')}`
        : ' without a configured overage budget';
}

function evaluateUser(user, userUsage, poolState, baselineResult = null, poolCaps = null) {
    const baseCC = baselineResult ? baselineResult.creditsFromCC : 0;
    const baseEnt = baselineResult ? baselineResult.creditsFromEntPool : 0;
    const baseMetered = baselineResult ? baselineResult.creditsMetered : 0;
    const baseCost = baselineResult ? baselineResult.meteredCost : 0;
    const baselineDrawn = baseCC + baseEnt + baseMetered;

    const result = {
        user: user.name,
        userId: user.id,
        usage: userUsage,
        status: 'served',
        source: '',
        reason: '',
        meteredCost: baseCost,
        ulbRemaining: null,
        creditsFromCC: baseCC,
        creditsFromEntPool: baseEnt,
        creditsMetered: baseMetered,
        meteredBudgetLabels: baselineResult?.meteredBudgetLabels || []
    };

    if (userUsage === 0) {
        result.source = 'No usage';
        const ulb = getEffectiveULB(user);
        result.ulbRemaining = ulb.value;
        return result;
    }

    // Step 1: ULB check
    const ulb = getEffectiveULB(user);
    if (ulb.value !== null && userUsage > ulb.value) {
        result.status = 'blocked';
        result.reason = `ULB exceeded (${formatSimulationCredits(ulb.value)} limit via ${ulb.source})`;
        result.ulbRemaining = 0;
        return result;
    }
    result.ulbRemaining = ulb.value !== null ? ulb.value - userUsage : null;

    // Only the usage beyond the already-consumed baseline is drawn in this phase.
    let remaining = Math.max(0, userUsage - baselineDrawn);
    const cc = getUserCC(user);

    // Step 2: CC pool
    if (cc && cc.poolEnabled) {
        const cap = poolCaps ? Math.max(0, poolCaps.cc) : Infinity;
        const available = Math.min(poolState.ccPools[cc.id] || 0, cap);
        const drawn = Math.min(remaining, available);
        poolState.ccPools[cc.id] -= drawn;
        result.creditsFromCC += drawn;
        remaining -= drawn;

        if (remaining > 0 && !cc.overagesAllowed) {
            result.status = 'blocked';
            result.reason = `CC pool exhausted & overages not allowed (${cc.name})`;
            return result;
        }
    }

    // Step 3: Enterprise pool
    if (remaining > 0) {
        const cap = poolCaps ? Math.max(0, poolCaps.ent) : Infinity;
        const drawn = Math.min(remaining, poolState.enterprisePool, cap);
        poolState.enterprisePool -= drawn;
        result.creditsFromEntPool += drawn;
        remaining -= drawn;
    }

    // Step 4: Metered phase
    if (remaining > 0) {
        if (!state.enterprise.meteredEnabled) {
            result.status = 'blocked';
            result.reason = 'Pool exhausted & metered usage not enabled';
            return result;
        }

        const org = user.orgId ? state.orgs.find(o => o.id === user.orgId) : null;
        const hasIndependentCostCenterBudget = userHasIndependentCostCenterBudget(user, cc);
        const hardStops = [];
        if (cc && cc.budget !== null && cc.budgetHardStop) {
            hardStops.push({
                affordable: meteredCreditsFromBudget(cc.budget - (poolState.ccMetered[cc.id] || 0)),
                reason: `CC budget exhausted (${formatSimulationBudget(cc.budget)}, ${cc.name})`
            });
        }
        if (org && org.budget !== null && org.budgetHardStop) {
            hardStops.push({
                affordable: meteredCreditsFromBudget(org.budget - (poolState.orgMetered[org.id] || 0)),
                reason: `Org budget exhausted (${formatSimulationBudget(org.budget)}, ${org.name})`
            });
        }
        if (!hasIndependentCostCenterBudget
            && state.enterprise.enterpriseBudget !== null
            && state.enterprise.enterpriseHardStop) {
            hardStops.push({
                affordable: meteredCreditsFromBudget(
                    state.enterprise.enterpriseBudget - poolState.enterpriseMetered),
                reason: `Enterprise budget exhausted (${formatSimulationBudget(state.enterprise.enterpriseBudget)})`
            });
        }

        const limitingStop = hardStops.reduce(
            (limit, candidate) => !limit || candidate.affordable < limit.affordable ? candidate : limit,
            null);
        if (limitingStop && limitingStop.affordable <= 0) {
            result.status = 'blocked';
            result.reason = limitingStop.reason;
            return result;
        }
        const hardStopReason = limitingStop && remaining > limitingStop.affordable
            ? limitingStop.reason
            : '';
        if (hardStopReason) remaining = limitingStop.affordable;

        const deltaCost = remaining * 0.01;
        result.creditsMetered += remaining;
        result.meteredCost += deltaCost;
        result.meteredBudgetLabels = getMeteredBudgetLabels(user);
        if (cc) poolState.ccMetered[cc.id] = (poolState.ccMetered[cc.id] || 0) + deltaCost;
        if (org) poolState.orgMetered[org.id] = (poolState.orgMetered[org.id] || 0) + deltaCost;
        if (!hasIndependentCostCenterBudget) {
            poolState.enterpriseMetered += deltaCost;
        }

        result.status = hardStopReason ? 'blocked' : 'metered';
        result.reason = hardStopReason;
        result.source = formatConsumedSources(result);
        return result;
    }

    result.status = 'served';
    result.source = formatConsumedSources(result);
    return result;
}

function formatConsumedSources(outcome, user) {
    const meteredLabels = Array.isArray(outcome.meteredBudgetLabels)
        ? outcome.meteredBudgetLabels
        : getMeteredBudgetLabels(user);
    const sources = [
        { amount: outcome.creditsFromCC, label: 'CC pool' },
        { amount: outcome.creditsFromEntPool, label: 'Enterprise pool' },
        {
            amount: outcome.creditsMetered,
            label: `metered${formatMeteredBudgetContext(meteredLabels)}`
        }
    ];
    const consumed = sources
        .filter(source => Number(source.amount) > 0)
        .map(source => `${formatSimulationCredits(source.amount)} ${source.label}`);
    return consumed.length > 0 ? consumed.join(' + ') : 'No credits consumed';
}

function formatCallSource(outcome, user) {
    if ((outcome.usage || 0) === 0) return 'No usage';
    return formatConsumedSources(outcome, user);
}

function callReasonData(user, result) {
    if (result.status !== 'blocked') return null;
    const reason = result.reason || '';
    const cc = getUserCC(user);
    const org = user.orgId ? state.orgs.find(o => o.id === user.orgId) : null;
    if (reason.startsWith('ULB exceeded')) {
        const ulb = getEffectiveULB(user);
        return { type: 'ulb', limit: ulb.value, source: ulb.source };
    }
    if (reason.startsWith('CC budget exhausted') && cc) {
        return { type: 'cc-budget', budget: cc.budget, name: cc.name };
    }
    if (reason.startsWith('Org budget exhausted') && org) {
        return { type: 'org-budget', budget: org.budget, name: org.name };
    }
    if (reason.startsWith('Enterprise budget exhausted')) {
        return { type: 'enterprise-budget', budget: state.enterprise.enterpriseBudget };
    }
    if (reason.startsWith('CC pool exhausted') && cc) {
        return { type: 'cc-pool', name: cc.name };
    }
    if (reason === 'Pool exhausted & metered usage not enabled') {
        return { type: 'metered-disabled' };
    }
    return { type: 'text', text: reason };
}

function formatCallReason(data, fallback = '') {
    if (!data) return fallback;
    if (data.type === 'ulb') {
        return `ULB exceeded (${formatSimulationCredits(data.limit)} limit via ${data.source})`;
    }
    if (data.type === 'cc-budget') {
        return `CC budget exhausted (${formatSimulationBudget(data.budget)}, ${data.name})`;
    }
    if (data.type === 'org-budget') {
        return `Org budget exhausted (${formatSimulationBudget(data.budget)}, ${data.name})`;
    }
    if (data.type === 'enterprise-budget') {
        return `Enterprise budget exhausted (${formatSimulationBudget(data.budget)})`;
    }
    if (data.type === 'cc-pool') {
        return `CC pool exhausted & overages not allowed (${data.name})`;
    }
    if (data.type === 'metered-disabled') {
        return 'Pool exhausted & metered usage not enabled';
    }
    return data.text || fallback;
}

function computeSimulationResults(options = {}) {
    const poolState = initPoolState();
    const baseline = state.usageBaseline || {};

    // Phase 1 — Starting point: saved baseline usage consumes shared pools in user
    // list order. Only the pool state mutation is kept; the breakdown feeds phase 2.
    const baselineResults = {};
    state.users.forEach(user => {
        const total = state.usage[user.id] || 0;
        const base = Math.min(baseline[user.id] || 0, total);
        baselineResults[user.id] = base > 0
            ? evaluateUser(user, base, poolState)
            : null;
    });

    // Phase 2 — Applied changes. Shared pools and overage/metered budgets are drawn
    // in FIFO usage order: first by the user's first edit, then by user list order for
    // usage restored without an edit sequence.
    const resultsByUser = {};
    getUsageApplicationOrder().forEach(user => {
        resultsByUser[user.id] = evaluateUser(
            user, state.usage[user.id] || 0, poolState, baselineResults[user.id]);
    });

    // Phase 3 — Collect final hard-stop state (order-independent). A budget with a
    // hard stop caps the TOTAL overage its scope can draw. If the members' combined
    // overage demand exceeds that capacity, the budget is exhausted and the scope is
    // frozen for subsequent calls. This must not rewrite the ordered outcome of calls
    // that already happened.
    //
    //  • Cost center / org budgets model an admin spending cap on a group: once the
    //    cap is consumed, the whole group is frozen for its next call.
    //  • The enterprise budget only caps metered overage, so remaining pool credits
    //    can still serve a user's next call.
    const frozenCCs = new Set();
    const frozenOrgs = new Set();
    let enterpriseOverageExhausted = false;

    // A hard-stop scope freezes only when its final metered spend leaves no credit
    // of headroom. Using actual spend avoids falsely freezing a broader scope when
    // a tighter nested budget stopped the draw first.
    state.costCenters.forEach(cc => {
        if (!cc.budgetHardStop || cc.budget === null) return;
        const remaining = meteredCreditsFromBudget(
            cc.budget - (poolState.ccMetered[cc.id] || 0));
        if (remaining < 1) {
            frozenCCs.add(cc.id);
        }
    });

    state.orgs.forEach(org => {
        if (!org.budgetHardStop || org.budget === null) return;
        const remaining = meteredCreditsFromBudget(
            org.budget - (poolState.orgMetered[org.id] || 0));
        if (remaining < 1) {
            frozenOrgs.add(org.id);
        }
    });

    if (state.enterprise.enterpriseHardStop && state.enterprise.enterpriseBudget !== null) {
        enterpriseOverageExhausted = meteredCreditsFromBudget(
            state.enterprise.enterpriseBudget - poolState.enterpriseMetered) < 1;
    }

    const projectNextCall = (user) => {
        const usage = state.usage[user.id] || 0;
        const ulb = getEffectiveULB(user);
        if (ulb.value !== null && usage + 1 > ulb.value) {
            return {
                status: 'blocked',
                reason: `ULB exceeded (${formatSimulationCredits(ulb.value)} limit via ${ulb.source})`
            };
        }

        const cc = getUserCC(user);
        const hasIndependentCostCenterBudget = userHasIndependentCostCenterBudget(user, cc);
        if (cc && frozenCCs.has(cc.id)) {
            return {
                status: 'blocked',
                reason: `CC budget exhausted (${formatSimulationBudget(cc.budget)}, ${cc.name})`
            };
        }
        const org = user.orgId ? state.orgs.find(o => o.id === user.orgId) : null;
        if (org && frozenOrgs.has(org.id)) {
            return {
                status: 'blocked',
                reason: `Org budget exhausted (${formatSimulationBudget(org.budget)}, ${org.name})`
            };
        }

        if (cc && cc.poolEnabled && (poolState.ccPools[cc.id] || 0) >= 1) {
            return { status: 'served', reason: `CC pool available (${cc.name})` };
        }
        if (cc && cc.poolEnabled && !cc.overagesAllowed) {
            return {
                status: 'blocked',
                reason: `CC pool exhausted & overages not allowed (${cc.name})`
            };
        }
        if (poolState.enterprisePool >= 1) {
            return { status: 'served', reason: 'Enterprise pool available' };
        }
        if (!state.enterprise.meteredEnabled) {
            return { status: 'blocked', reason: 'Pool exhausted & metered usage not enabled' };
        }

        if (cc && cc.budget !== null && cc.budgetHardStop
            && meteredCreditsFromBudget(cc.budget - (poolState.ccMetered[cc.id] || 0)) < 1) {
            return {
                status: 'blocked',
                reason: `CC budget exhausted (${formatSimulationBudget(cc.budget)}, ${cc.name})`
            };
        }
        if (org && org.budget !== null && org.budgetHardStop
            && meteredCreditsFromBudget(org.budget - (poolState.orgMetered[org.id] || 0)) < 1) {
            return {
                status: 'blocked',
                reason: `Org budget exhausted (${formatSimulationBudget(org.budget)}, ${org.name})`
            };
        }
        if (!hasIndependentCostCenterBudget
            && state.enterprise.enterpriseHardStop
            && state.enterprise.enterpriseBudget !== null
            && (enterpriseOverageExhausted
                || meteredCreditsFromBudget(
                    state.enterprise.enterpriseBudget - poolState.enterpriseMetered) < 1)) {
            return {
                status: 'blocked',
                reason: `Enterprise budget exhausted (${formatSimulationBudget(state.enterprise.enterpriseBudget)})`
            };
        }
        return {
            status: 'metered',
            reason: `Metered usage available${formatMeteredBudgetContext(getMeteredBudgetLabels(user))}`
        };
    };

    Object.values(resultsByUser).forEach(r => {
        const evaluatedStatus = r.status;
        const evaluatedReason = r.reason;
        const saved = !options.ignoreSavedLastCalls && state.lastCallOutcomes
            ? state.lastCallOutcomes[r.userId]
            : null;
        r.lastCallStatus = saved && saved.status ? saved.status : evaluatedStatus;
        r.lastCallReasonData = saved && saved.reasonData
            ? saved.reasonData
            : callReasonData(state.users.find(u => u.id === r.userId), {
                status: evaluatedStatus,
                reason: evaluatedReason
            });
        r.lastCallReason = formatCallReason(
            r.lastCallReasonData,
            saved && typeof saved.reason === 'string' ? saved.reason : evaluatedReason);
        r.lastCallUsage = saved && Number.isFinite(saved.usage) ? saved.usage : r.usage;
        r.lastCallCreditsFromCC = saved && Number.isFinite(saved.creditsFromCC)
            ? saved.creditsFromCC : r.creditsFromCC;
        r.lastCallCreditsFromEntPool = saved && Number.isFinite(saved.creditsFromEntPool)
            ? saved.creditsFromEntPool : r.creditsFromEntPool;
        r.lastCallCreditsMetered = saved && Number.isFinite(saved.creditsMetered)
            ? saved.creditsMetered : r.creditsMetered;
        r.lastCallMeteredCost = saved && Number.isFinite(saved.meteredCost)
            ? saved.meteredCost : r.meteredCost;
        r.lastCallMeteredBudgetLabels = saved && Array.isArray(saved.meteredBudgetLabels)
            ? saved.meteredBudgetLabels : r.meteredBudgetLabels;
        const resultUser = state.users.find(u => u.id === r.userId);
        r.lastCallSource = formatCallSource({
            status: r.lastCallStatus,
            usage: r.lastCallUsage,
            creditsFromCC: r.lastCallCreditsFromCC,
            creditsFromEntPool: r.lastCallCreditsFromEntPool,
            creditsMetered: r.lastCallCreditsMetered,
            meteredBudgetLabels: r.lastCallMeteredBudgetLabels
        }, resultUser);
        const next = projectNextCall(resultUser);
        r.nextCallStatus = next.status;
        r.nextCallReason = next.reason;
        // Compatibility for consumers that still read the former single-status fields.
        r.status = r.lastCallStatus;
        r.reason = r.lastCallReason;
    });

    // Results are reported in list order, independent of the application order.
    const results = state.users.map(user => resultsByUser[user.id]);
    return { results, poolState };
}

function runSimulation() {
    if (state.users.length === 0) {
        document.getElementById('simulationResultsCard').style.display = 'none';
        return;
    }
    const { results, poolState } = computeSimulationResults();
    renderSimulationResults(results, poolState);
}

function renderSimulationResults(results, poolState) {
    document.getElementById('simulationResultsCard').style.display = 'block';

    // Budget status gauges
    document.getElementById('simBudgetStatus').innerHTML = renderBudgetStatusGauges(poolState);

    const served = results.filter(r => r.lastCallStatus === 'served').length;
    const metered = results.filter(r => r.lastCallStatus === 'metered').length;
    const blocked = results.filter(r => r.lastCallStatus === 'blocked').length;
    const blockedNext = results.filter(r => r.nextCallStatus === 'blocked').length;
    const totalMeteredCost = results.reduce((s, r) => s + r.lastCallMeteredCost, 0);

    document.getElementById('simSummaryStats').innerHTML = `
        <div class="stat-card" data-summary="served"><div class="stat-value" style="color:var(--color-success)">${served}</div><div class="stat-label">Served (Pool)</div></div>
        <div class="stat-card" data-summary="metered"><div class="stat-value" style="color:var(--color-warning)">${metered}</div><div class="stat-label">Metered</div></div>
        <div class="stat-card" data-summary="blocked"><div class="stat-value" style="color:var(--color-danger)">${blocked}</div><div class="stat-label">Blocked</div></div>
        <div class="stat-card" data-summary="blocked-next"><div class="stat-value" style="color:var(--color-danger)">${blockedNext}</div><div class="stat-label">Next Call Blocked</div></div>
        <div class="stat-card" data-summary="metered-total"><div class="stat-value">${formatSimulationBudget(totalMeteredCost)}</div><div class="stat-label">${isSimulationDollarMode() ? 'Total Metered Cost' : 'Total Metered Usage'}</div></div>
        <div class="stat-card" data-summary="enterprise-pool-remaining"><div class="stat-value">${formatSimulationCredits(Math.max(0, poolState.enterprisePool))}</div><div class="stat-label">Ent. Pool Remaining</div></div>
    `;

    let html = `<table><thead><tr>
        <th>User</th>
        <th>Cost Center</th>
        <th>Consumption (${escapeHtml(getSimulationUnitLabel())})</th>
        <th>Last Call</th>
        <th>Last Call Details</th>
        <th>Next Call</th>
        <th>Next Call Reason</th>
    </tr></thead><tbody>`;
    results.forEach(r => {
        const user = state.users.find(u => u.id === r.userId);
        const cc = user ? getUserCC(user) : null;
        const effectiveULB = user ? getEffectiveULB(user) : { value: null, source: 'Unlimited' };
        const userMax = user ? getUserSimulationMax(user) : 0;
        const maxCredits = Math.max(userMax, r.usage);
        const rowClass = r.lastCallStatus === 'blocked' ? 'result-blocked' : r.lastCallStatus === 'metered' ? 'result-metered' : '';
        const statusBadge = (status, legacyRole = false) => {
            const badgeClass = status === 'blocked' ? 'badge-danger' : status === 'metered' ? 'badge-warning' : 'badge-success';
            const role = legacyRole ? ' data-role="status"' : '';
            return `<span class="badge ${badgeClass}"${role}>${escapeHtml(status)}</span>`;
        };
        html += `<tr class="${rowClass}" data-user-id="${escapeHtml(r.userId)}" data-user-name="${escapeHtml(r.user.toLowerCase())}">
            <td data-role="user-name"><strong>${escapeHtml(r.user)}</strong></td>
            <td data-role="cost-center">${cc ? escapeHtml(cc.name) : '—'}</td>
            <td data-role="usage">
                <div class="sim-user-usage">
                    <input type="range" min="0" max="${maxCredits}" step="1" value="${r.usage}"
                        data-role="range"
                        oninput="this.nextElementSibling.value = creditsToSimulationValue(parseInt(this.value,10))"
                        onchange="applyUserUsageChange('${escapeInlineArg(r.userId)}', this.value)">
                    <input type="number" min="0" max="${creditsToSimulationValue(maxCredits)}" step="${simulationUsageStep()}" value="${creditsToSimulationValue(r.usage)}"
                        data-role="number"
                        onchange="applyUserUsageChange('${escapeInlineArg(r.userId)}', simulationValueToCredits(this.value))">
                    <span class="sim-ulb-total" data-role="ulb-total"
                        title="Effective total ULB: ${escapeHtml(effectiveULB.source)}"
                        aria-label="Effective total ULB: ${escapeHtml(effectiveULB.source)}">/${escapeHtml(formatSimulationLimitValue(effectiveULB.value))}</span>
                </div>
            </td>
            <td data-role="status-last">${statusBadge(r.lastCallStatus, true)}</td>
            <td data-role="last-details">${escapeHtml(r.lastCallStatus === 'blocked' ? r.lastCallReason : r.lastCallSource)}</td>
            <td data-role="status-next">${statusBadge(r.nextCallStatus)}</td>
            <td class="next-call-reason" data-role="next-reason">${escapeHtml(r.nextCallReason)}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('simulationResults').innerHTML = html;

    // Re-apply name filter if active
    const filterInput = document.getElementById('simUserFilter');
    if (filterInput && filterInput.value) filterSimUsers(filterInput.value);
}

function renderBudgetStatusGauges(poolState) {
    const reserved = state.costCenters.filter(cc => cc.poolEnabled).reduce((s, cc) => s + getCCPoolSize(cc), 0);
    const initialEntPool = totalPool() - reserved;
    const gauges = [];

    if (initialEntPool > 0) {
        const used = initialEntPool - Math.max(0, poolState.enterprisePool);
        const pct = used / initialEntPool * 100;
        gauges.push({ key: 'enterprise-pool', label: 'Enterprise Pool', used: formatSimulationCredits(used), total: formatSimulationCredits(initialEntPool), pct });
    }

    state.costCenters.filter(cc => cc.poolEnabled).forEach(cc => {
        const initial = getCCPoolSize(cc);
        const remaining = poolState.ccPools[cc.id] !== undefined ? poolState.ccPools[cc.id] : initial;
        const used = initial - Math.max(0, remaining);
        const pct = initial > 0 ? used / initial * 100 : 0;
        gauges.push({ key: `cc-pool-${cc.id}`, label: escapeHtml(cc.name) + ' Pool', used: formatSimulationCredits(used), total: formatSimulationCredits(initial), pct });
    });

    if (state.enterprise.enterpriseBudget > 0) {
        const used = poolState.enterpriseMetered;
        const total = state.enterprise.enterpriseBudget;
        const pct = total > 0 ? used / total * 100 : 0;
        gauges.push({ key: 'enterprise-budget', label: 'Enterprise Budget', used: formatSimulationBudget(used), total: formatSimulationBudget(total), pct });
    }

    state.costCenters.filter(cc => cc.budget !== null && cc.budget !== undefined && cc.budget > 0).forEach(cc => {
        const used = poolState.ccMetered[cc.id] || 0;
        const pct = cc.budget > 0 ? used / cc.budget * 100 : 0;
        gauges.push({ key: `cc-budget-${cc.id}`, label: escapeHtml(cc.name) + ' Budget', used: formatSimulationBudget(used), total: formatSimulationBudget(cc.budget), pct });
    });

    state.orgs.filter(org => org.budget !== null && org.budget !== undefined && org.budget > 0).forEach(org => {
        const used = poolState.orgMetered[org.id] || 0;
        const pct = org.budget > 0 ? used / org.budget * 100 : 0;
        gauges.push({ key: `org-budget-${org.id}`, label: escapeHtml(org.name) + ' Budget', used: formatSimulationBudget(used), total: formatSimulationBudget(org.budget), pct });
    });

    if (gauges.length === 0) return '';

    let html = '<div class="budget-status-grid">';
    gauges.forEach(g => {
        const color = g.pct >= 100 ? 'var(--color-danger)' : g.pct >= 75 ? 'var(--color-warning)' : 'var(--color-success)';
        html += `<div class="budget-gauge-card" data-gauge-key="${escapeHtml(g.key)}">
            <div class="budget-gauge-header">
                <span class="budget-gauge-label">${g.label}</span>
                <span data-role="percent" style="color:${color};font-weight:700;font-size:0.8125rem">${g.pct.toFixed(1)}%</span>
            </div>
            <div class="progress-bar" style="margin:4px 0">
                <div class="progress-fill" style="width:${Math.min(100, g.pct)}%;background:${color}"></div>
            </div>
            <div class="budget-gauge-amounts"><span data-role="used">${escapeHtml(g.used)}</span> / <span data-role="total">${escapeHtml(g.total)}</span></div>
        </div>`;
    });
    html += '</div>';
    return html;
}

function filterSimUsers(query) {
    const q = (query || '').toLowerCase().trim();
    document.querySelectorAll('#simulationResults tbody tr').forEach(tr => {
        const name = tr.dataset.userName || '';
        tr.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
}

function getUserSimulationCapacity(user) {
    const baseCredits = userCreditsPerSeat(user);
    const ulb = getEffectiveULB(user);
    return ulb.value !== null ? Math.min(baseCredits, ulb.value) : baseCredits;
}

// Real maximum credits a user could ever consume: their served seat pool plus
// every overage budget they can draw on (CC, org, enterprise), or their ULB cap.
function getUserSimulationMax(user) {
    const ulb = getEffectiveULB(user);
    if (ulb.value !== null) return ulb.value;

    let maxCredits = userCreditsPerSeat(user);

    if (state.enterprise.meteredEnabled) {
        let overageBudget = 0;
        const cc = getUserCC(user);
        if (cc && cc.budget !== null && cc.budget !== undefined && cc.budget > 0) overageBudget += cc.budget;
        const org = user.orgId ? state.orgs.find(o => o.id === user.orgId) : null;
        if (org && org.budget !== null && org.budget !== undefined && org.budget > 0) overageBudget += org.budget;
        if (state.enterprise.enterpriseBudget > 0) overageBudget += state.enterprise.enterpriseBudget;
        maxCredits += meteredCreditsFromBudget(overageBudget);
    }

    return maxCredits;
}

function getTotalSimulationCapacity() {
    return state.users.reduce((sum, user) => sum + getUserSimulationCapacity(user), 0);
}

function getTotalSimulationUsage() {
    return state.users.reduce((sum, user) => sum + (state.usage[user.id] || 0), 0);
}

function getSimulationUnit() {
    return state.simulationUnit === 'dollars' ? 'dollars' : 'credits';
}

function isSimulationDollarMode() {
    return getSimulationUnit() === 'dollars';
}

function getSimulationUnitLabel() {
    return isSimulationDollarMode() ? '$' : 'AI credits';
}

function simulationUsageStep() {
    return isSimulationDollarMode() ? 0.01 : 1;
}

function creditsToSimulationValue(credits) {
    return isSimulationDollarMode() ? (credits / CREDITS_PER_DOLLAR) : credits;
}

function simulationValueToCredits(value) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return 0;
    const sanitized = Math.max(0, parsed);
    return isSimulationDollarMode() ? Math.round(sanitized * CREDITS_PER_DOLLAR) : Math.round(sanitized);
}

function formatSimulationCredits(credits) {
    if (credits === null || credits === undefined) return '—';
    return isSimulationDollarMode()
        ? `$${(creditsToSimulationValue(credits)).toFixed(2)}`
        : `${fmt(Math.round(credits))} AI credits`;
}

function formatSimulationBudget(amount) {
    if (amount === null || amount === undefined) return '—';
    return isSimulationDollarMode()
        ? `$${amount.toFixed(2)}`
        : `${fmt(meteredCreditsFromBudget(amount))} AI credits`;
}

function formatSimulationLimitValue(credits) {
    if (credits === null || credits === undefined) return '∞';
    return isSimulationDollarMode()
        ? creditsToSimulationValue(credits).toFixed(2)
        : fmt(Math.round(credits));
}

function setUserUsageValue(userId, value) {
    state.usage[userId] = Math.max(0, parseInt(value, 10) || 0);
}

// The consumption sequence keeps one entry per user, in the order each user was
// first changed. Re-editing a user only updates their value: going 50 → 100 → 80
// on one user keeps their single, original position in the sequence.
function recordUsageChange(userId) {
    if (!Array.isArray(state.usageSequence)) state.usageSequence = [];
    if (state.usageSequence.includes(userId)) return;
    state.usageSequence.push(userId);
}

function clearUsageSequence() {
    state.usageSequence = [];
}

// Users in the order their consumption must be applied: the order in which they
// were first changed. Duplicate entries (from legacy/imported states) collapse to
// the first occurrence; users never edited come last, in list order.
function getUsageApplicationOrder() {
    const sequence = Array.isArray(state.usageSequence) ? state.usageSequence : [];
    const seen = new Set();
    const ordered = [];
    sequence.forEach(id => {
        const user = state.users.find(u => u.id === id);
        if (!user || seen.has(id)) return;
        seen.add(id);
        ordered.push(user);
    });
    state.users.forEach(user => {
        if (seen.has(user.id)) return;
        seen.add(user.id);
        ordered.push(user);
    });
    return ordered;
}

function applyUserUsageChange(userId, creditsValue) {
    const before = computeSimulationResults();
    state.lastCallOutcomes = Object.fromEntries(before.results.map(result => [
        result.userId,
        {
            status: result.lastCallStatus,
            reason: result.lastCallReason,
            reasonData: result.lastCallReasonData,
            usage: result.lastCallUsage,
            creditsFromCC: result.lastCallCreditsFromCC,
            creditsFromEntPool: result.lastCallCreditsFromEntPool,
            creditsMetered: result.lastCallCreditsMetered,
            meteredCost: result.lastCallMeteredCost,
            meteredBudgetLabels: result.lastCallMeteredBudgetLabels
        }
    ]));
    setUserUsageValue(userId, creditsValue);
    recordUsageChange(userId);
    const after = computeSimulationResults({ ignoreSavedLastCalls: true });
    const changed = after.results.find(result => result.userId === userId);
    if (changed) {
        state.lastCallOutcomes[userId] = {
            status: changed.lastCallStatus,
            reason: changed.lastCallReason,
            reasonData: changed.lastCallReasonData,
            usage: changed.lastCallUsage,
            creditsFromCC: changed.lastCallCreditsFromCC,
            creditsFromEntPool: changed.lastCallCreditsFromEntPool,
            creditsMetered: changed.lastCallCreditsMetered,
            meteredCost: changed.lastCallMeteredCost,
            meteredBudgetLabels: changed.lastCallMeteredBudgetLabels
        };
    }
    saveState();
    runSimulation();
}

// ─── Global Budget Simulation ─────────────────────────────────────────────────
function setGlobalBudgetPercent(key, value) {
    if (!state.globalBudgetPercents) state.globalBudgetPercents = {};
    const pct = Math.max(0, Math.min(100, parseFloat(value) || 0));
    state.globalBudgetPercents[key] = pct;

    // Sync all inputs for this key without re-rendering the whole card
    document.querySelectorAll('[data-budget-key]').forEach(el => {
        if (el.dataset.budgetKey === key) el.value = pct.toFixed(1);
    });
    // Update progress bar and % label in the control row
    document.querySelectorAll('[data-budget-row]').forEach(row => {
        if (row.dataset.budgetRow !== key) return;
        const color = pct >= 100 ? 'var(--color-danger)' : pct >= 75 ? 'var(--color-warning)' : 'var(--color-accent)';
        const pctLabel = row.querySelector('.budget-control-pct');
        if (pctLabel) { pctLabel.textContent = pct.toFixed(1) + '%'; pctLabel.style.color = color; }
        const fill = row.querySelector('.progress-fill');
        if (fill) { fill.style.width = Math.min(100, pct) + '%'; fill.style.background = color; }
    });

    applyAllGlobalBudgetPercents();
}

function applyAllGlobalBudgetPercents() {
    const newUsage = {};
    state.users.forEach(u => { newUsage[u.id] = 0; });

    const percents = state.globalBudgetPercents || {};

    // Enterprise unreserved pool → users not in a CC with a pool
    const entPoolPct = percents['enterprisePool'] || 0;
    if (entPoolPct > 0) {
        const reserved = state.costCenters.filter(cc => cc.poolEnabled)
            .reduce((s, cc) => s + getCCPoolSize(cc), 0);
        const entPool = totalPool() - reserved;
        const eligible = state.users.filter(u => { const cc = getUserCC(u); return !cc || !cc.poolEnabled; });
        if (eligible.length > 0 && entPool > 0) {
            const perUser = Math.floor(entPool * entPoolPct / 100 / eligible.length);
            eligible.forEach(u => { newUsage[u.id] += perUser; });
        }
    }

    // CC pools → CC members equally
    state.costCenters.filter(cc => cc.poolEnabled).forEach(cc => {
        const pct = percents['ccPool_' + cc.id] || 0;
        if (pct > 0) {
            const ccPool = getCCPoolSize(cc);
            const ccUsers = getAssignedCCMembers(cc);
            if (ccUsers.length > 0 && ccPool > 0) {
                const perUser = Math.floor(ccPool * pct / 100 / ccUsers.length);
                ccUsers.forEach(u => { newUsage[u.id] += perUser; });
            }
        }
    });

    // Enterprise overage budget → independence-aware targets equally
    const entOverPct = percents['enterpriseOverage'] || 0;
    if (entOverPct > 0 && state.enterprise.meteredEnabled && state.enterprise.enterpriseBudget > 0) {
        const totalCredits = meteredCreditsFromBudget(state.enterprise.enterpriseBudget * entOverPct / 100);
        const targets = getOverageBudgetTargets({ type: 'enterprise' });
        if (targets.length > 0) {
            const perUser = Math.floor(totalCredits / targets.length);
            targets.forEach(u => {
                newUsage[u.id] = Math.floor(Math.max(newUsage[u.id], getUserPoolEntitlement(u)));
                newUsage[u.id] += perUser;
            });
        }
    }

    // CC overage budgets → CC targets equally
    state.costCenters.filter(cc => cc.budget !== null && cc.budget !== undefined && cc.budget > 0).forEach(cc => {
        const pct = percents['ccOverage_' + cc.id] || 0;
        if (pct > 0) {
            const targets = getOverageBudgetTargets({ type: 'cc', cc });
            if (targets.length > 0) {
                const totalCredits = meteredCreditsFromBudget(cc.budget * pct / 100);
                const perUser = Math.floor(totalCredits / targets.length);
                targets.forEach(u => {
                    newUsage[u.id] = Math.floor(Math.max(newUsage[u.id], getUserPoolEntitlement(u)));
                    newUsage[u.id] += perUser;
                });
            }
        }
    });

    // Org overage budgets → org targets equally
    state.orgs.filter(org => org.budget !== null && org.budget !== undefined && org.budget > 0).forEach(org => {
        const pct = percents['orgOverage_' + org.id] || 0;
        if (pct > 0) {
            const targets = getOverageBudgetTargets({ type: 'org', org });
            if (targets.length > 0) {
                const totalCredits = meteredCreditsFromBudget(org.budget * pct / 100);
                const perUser = Math.floor(totalCredits / targets.length);
                targets.forEach(u => {
                    newUsage[u.id] = Math.floor(Math.max(newUsage[u.id], getUserPoolEntitlement(u)));
                    newUsage[u.id] += perUser;
                });
            }
        }
    });

    state.users.forEach(u => { state.usage[u.id] = newUsage[u.id] || 0; });
    // A global distribution replaces every user's consumption at once, so no
    // per-user change order applies until the user edits users individually again.
    clearUsageSequence();
    state.lastCallOutcomes = {};
    saveState();
    runSimulation();
}

const BUDGET_TARGET_META = {
    enterprise: { icon: '🏢', label: 'Enterprise' },
    cc: { icon: '📂', label: 'Cost Center' },
    org: { icon: '🏛️', label: 'Organization' }
};

function renderBudgetControl(key, label, capacityStr, userCount, currentPct, opts = {}) {
    const variant = opts.variant === 'pool' ? 'pool' : 'overage';
    const targetMeta = BUDGET_TARGET_META[opts.targetType] || BUDGET_TARGET_META.enterprise;
    const color = currentPct >= 100 ? 'var(--color-danger)' : currentPct >= 75 ? 'var(--color-warning)' : 'var(--color-accent)';
    const safeKey = escapeInlineArg(key);
    return `<div class="budget-control-row budget-control-row--${variant}" data-budget-row="${escapeHtml(key)}">
        <div class="budget-control-header">
            <div class="budget-control-titles">
                <span class="budget-control-target"><span aria-hidden="true">${targetMeta.icon}</span>${targetMeta.label}</span>
                <span class="budget-control-label">${escapeHtml(label)}</span>
                <span class="help-text">${escapeHtml(capacityStr)} · <span class="badge ${userCount > 0 ? 'badge-info' : 'badge-warning'}">${userCount} user${userCount !== 1 ? 's' : ''}</span></span>
            </div>
            <span class="budget-control-pct" style="color:${color}">${currentPct.toFixed(1)}%</span>
        </div>
        <div class="budget-control-slider">
            <input type="range" min="0" max="100" step="0.5" value="${currentPct.toFixed(1)}"
                data-budget-key="${escapeHtml(key)}"
                oninput="setGlobalBudgetPercent('${safeKey}', this.value)">
            <div class="budget-control-input-wrap">
                <input type="number" min="0" max="100" step="0.5" value="${currentPct.toFixed(1)}"
                    data-budget-key="${escapeHtml(key)}"
                    onchange="setGlobalBudgetPercent('${safeKey}', this.value)">
                <span>%</span>
            </div>
        </div>
        <div class="progress-bar" style="margin-top:6px">
            <div class="progress-fill" style="width:${Math.min(100, currentPct)}%;background:${color}"></div>
        </div>
    </div>`;
}

// ─── Global Budget Simulation Render ─────────────────────────────────────────
function renderGlobalBudgetSimulation() {
    const globalControls = document.getElementById('globalBudgetControls');
    const unitMode = document.getElementById('simulationUnitMode');
    if (unitMode) unitMode.value = getSimulationUnit();

    if (state.users.length === 0) {
        globalControls.innerHTML = '<div class="empty-state"><p>Add users first to simulate usage.</p></div>';
        document.getElementById('simulationResultsCard').style.display = 'none';
        return;
    }

    const percents = state.globalBudgetPercents || {};
    let poolHtml = '';
    let overageHtml = '';

    // Enterprise unreserved pool
    const reserved = state.costCenters.filter(cc => cc.poolEnabled).reduce((s, cc) => s + getCCPoolSize(cc), 0);
    const entPool = totalPool() - reserved;
    const eligibleForEntPool = state.users.filter(u => { const cc = getUserCC(u); return !cc || !cc.poolEnabled; });
    if (entPool > 0) {
        const pct = percents['enterprisePool'] || 0;
        const entOverageTargets = getOverageBudgetTargets({ type: 'enterprise' });
        const entOverageTargetIds = new Set(entOverageTargets.map(user => user.id));
        const entPoolHint = state.enterprise.meteredEnabled
            && state.enterprise.enterpriseBudget > 0
            && (percents['enterpriseOverage'] || 0) > 0
            && eligibleForEntPool.some(user => entOverageTargetIds.has(user.id))
            ? ' · Enterprise overage will fill targeted users\' pool to 100% first'
            : '';
        poolHtml += renderBudgetControl('enterprisePool', 'Enterprise Shared Pool',
            `${formatSimulationCredits(entPool)} total${entPoolHint}`,
            eligibleForEntPool.length, pct, { variant: 'pool', targetType: 'enterprise' });
    }

    // CC pools
    state.costCenters.filter(cc => cc.poolEnabled).forEach(cc => {
        const ccPool = getCCPoolSize(cc);
        const ccUsers = getAssignedCCMembers(cc);
        if (ccPool > 0) {
            const pct = percents['ccPool_' + cc.id] || 0;
            const ccPoolHint = (percents['ccOverage_' + cc.id] || 0) > 0 && cc.budget !== null && cc.budget !== undefined && cc.budget > 0
                ? ' · CC overage will fill this pool to 100% first'
                : '';
            poolHtml += renderBudgetControl('ccPool_' + cc.id, cc.name + ' Pool',
                `${formatSimulationCredits(ccPool)} total${ccPoolHint}`,
                ccUsers.length, pct, { variant: 'pool', targetType: 'cc' });
        }
    });

    // Enterprise overage budget
    if (state.enterprise.meteredEnabled && state.enterprise.enterpriseBudget > 0) {
        const pct = percents['enterpriseOverage'] || 0;
        const entOverageTargets = getOverageBudgetTargets({ type: 'enterprise' });
        overageHtml += renderBudgetControl('enterpriseOverage', 'Enterprise Overage Budget',
            `${formatSimulationBudget(state.enterprise.enterpriseBudget)} total`,
            entOverageTargets.length, pct, { variant: 'overage', targetType: 'enterprise' });
    }

    // CC overage budgets
    state.costCenters.filter(cc => cc.budget !== null && cc.budget !== undefined && cc.budget > 0).forEach(cc => {
        const ccOverageTargets = getOverageBudgetTargets({ type: 'cc', cc });
        const pct = percents['ccOverage_' + cc.id] || 0;
        overageHtml += renderBudgetControl('ccOverage_' + cc.id, cc.name + ' Overage Budget',
            `${formatSimulationBudget(cc.budget)} total`,
            ccOverageTargets.length, pct, { variant: 'overage', targetType: 'cc' });
    });

    // Org overage budgets
    state.orgs.filter(org => org.budget !== null && org.budget !== undefined && org.budget > 0).forEach(org => {
        const orgOverageTargets = getOverageBudgetTargets({ type: 'org', org });
        const pct = percents['orgOverage_' + org.id] || 0;
        overageHtml += renderBudgetControl('orgOverage_' + org.id, org.name + ' Overage Budget',
            `${formatSimulationBudget(org.budget)} total`,
            orgOverageTargets.length, pct, { variant: 'overage', targetType: 'org' });
    });

    let html = '';
    if (poolHtml) {
        html += `<h3 class="budget-group-title">🏊 Pool Usage <span class="help-text">Credits reserved from license seats</span></h3>
            <div class="budget-control-grid">${poolHtml}</div>`;
    }
    if (overageHtml) {
        const overageIndependenceToggle = `<label class="checkbox-label" style="margin-bottom:12px"><input type="checkbox" data-bind="costCenterBudgetsIndependent" ${state.enterprise.costCenterBudgetsIndependent ? 'checked' : ''} onchange="setCostCenterBudgetsIndependent(this.checked)"> Cost center overage budgets are independent of enterprise budget</label>`;
        html += `<h3 class="budget-group-title">💳 Overage Budgets <span class="help-text">Metered spend beyond the pool</span></h3>
            ${overageIndependenceToggle}
            <div class="budget-control-grid">${overageHtml}</div>`;
    }
    if (!html) {
        html = '<p class="help-text">No budgets configured yet. Set up seat licenses and/or overage budgets first.</p>';
    }

    globalControls.innerHTML = html;
    updateStartingPointStatus();
    runSimulation();
}

function setSimulationUnit(unit) {
    state.simulationUnit = unit === 'dollars' ? 'dollars' : 'credits';
    saveState();
    renderGlobalBudgetSimulation();
}

function setStartingPoint() {
    state.usageBaseline = { ...state.usage };
    clearUsageSequence();
    state.lastCallOutcomes = {};
    saveState();
    updateStartingPointStatus();
    runSimulation();
}

function hasStartingPoint() {
    const baseline = state.usageBaseline || {};
    return Object.values(baseline).some(v => (v || 0) > 0);
}

function updateStartingPointStatus() {
    const el = document.getElementById('startingPointStatus');
    if (!el) return;
    if (hasStartingPoint()) {
        const total = Object.values(state.usageBaseline || {}).reduce((s, v) => s + (v || 0), 0);
        el.textContent = `📌 Starting point set (${formatSimulationCredits(total)})`;
        el.style.color = 'var(--color-success)';
    } else {
        el.textContent = 'No starting point set yet';
        el.style.color = 'var(--color-text-muted)';
    }
}

function resetUsage() {
    state.usage = {};
    state.usageBaseline = {};
    state.globalBudgetPercents = {};
    clearUsageSequence();
    state.lastCallOutcomes = {};
    saveState();
    renderGlobalBudgetSimulation();
}

// ─── Navigation ──────────────────────────────────────────────────────────────
document.getElementById('mainNav').addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    document.querySelectorAll('#mainNav button').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-' + e.target.dataset.panel).classList.add('active');
    const panel = e.target.dataset.panel;
    if (panel === 'pool') renderPoolView();
    if (panel === 'simulate') { renderCCPoolToggles(); renderGlobalBudgetSimulation(); renderDashboardState(); }
    if (panel === 'budgets') renderBudgets();
    if (panel === 'enterprise') { renderEnterpriseStats(); }
    if (panel === 'orgmap') renderOrgMap();
});

// ─── Tab Counts ────────────────────────────────────────────────────────────
function renderTabCounts() {
    // no-op: tab labels are static; counts are visible in the wizard per-step
}

// ─── Utilities ───────────────────────────────────────────────────────────────
function fmt(n) {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString();
}

// ─── Render All ──────────────────────────────────────────────────────────────
function renderAll() {
    renderEnterprise();
    renderCCTeamDropdown();
    renderCCOrgDropdown();
    renderCCUserDropdown();
    renderCostCenters();
    renderUserCCDropdown();
    renderUserOrgDropdown();
    renderUserTeamDropdown();
    renderUsers();
    renderBudgets();
    renderPoolView();
    renderGlobalBudgetSimulation();
    renderOrgMap();
    renderTabCounts();
    updateUserCreateMode();
    renderDashboardState();
}

// ─── Dashboard empty / content state ────────────────────────────────────────
function hasAnyData() {
    return state.users.length > 0 || state.costCenters.length > 0 ||
           state.orgs.length > 0 || state.teams.length > 0;
}

function hasConfigurationChanges() {
    return !configurationEquals(state, defaultState());
}

function configurationEquals(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((value, index) => configurationEquals(value, b[index]));
    }

    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    if (aKeys.some((key, index) => key !== bKeys[index])) return false;
    return aKeys.every(key => configurationEquals(a[key], b[key]));
}

function renderDashboardState() {
    const empty = document.getElementById('dashboardEmpty');
    const content = document.getElementById('dashboardContent');
    if (!empty || !content) return;
    const showEmpty = !hasAnyData();
    empty.style.display = showEmpty ? 'flex' : 'none';
    content.style.display = showEmpty ? 'none' : 'block';
}

// ─── Setup Wizard ─────────────────────────────────────────────────────────────
const WIZARD_STEPS = [
    { label: 'Organizations' },
    { label: 'Teams' },
    { label: 'Cost Centers' },
    { label: 'Users' },
    { label: 'User Budgets' },
    { label: 'Overage Budgets' },
    { label: 'Review' }
];

const MAX_BULK_USER_COUNT = 500;

function escapeRegexPattern(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let wizardStep = 0;
let wizardDone = false;
let wizardData = null;
let wizardEditingExistingKey = null;

function defaultWizardData() {
    return {
        orgs: [],
        teams: [],
        costCenters: [],
        users: [],
        userBudgets: {
            universalULB: state.enterprise.universalULB !== null ? creditsToDollars(state.enterprise.universalULB).toFixed(2) : '',
            individual: [],
            costCenter: []
        },
        overageBudgets: {
            enterpriseBudget: state.enterprise.enterpriseBudget,
            enterpriseHardStop: state.enterprise.enterpriseHardStop,
            costCenterBudgetsIndependent: state.enterprise.costCenterBudgetsIndependent,
            orgs: [],
            costCenters: []
        }
    };
}

function openWizard() {
    wizardStep = 0;
    wizardDone = false;
    wizardData = defaultWizardData();
    wizardEditingExistingKey = null;
    document.getElementById('wizardOverlay').style.display = 'flex';
    renderWizard();
}

function openWizardAtStep(step) {
    wizardStep = step;
    wizardDone = false;
    wizardData = defaultWizardData();
    wizardEditingExistingKey = null;
    document.getElementById('wizardOverlay').style.display = 'flex';
    renderWizard();
}

function closeWizard() {
    if (!wizardDone) {
        const hasData = wizardData && (
            wizardData.orgs.length > 0 || wizardData.teams.length > 0 ||
            wizardData.costCenters.length > 0 || wizardData.users.length > 0 ||
            wizardData.userBudgets.individual.length > 0 ||
            wizardData.userBudgets.costCenter.length > 0 ||
            wizardData.overageBudgets.orgs.length > 0 ||
            wizardData.overageBudgets.costCenters.length > 0
        );
        if (hasData && !confirm('Close wizard? Unsaved entries will be lost.')) return;
    }
    document.getElementById('wizardOverlay').style.display = 'none';
}

function handleWizardOverlayClick(e) {
    if (e.target === document.getElementById('wizardOverlay')) closeWizard();
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('wizardOverlay').style.display !== 'none') closeWizard();
});

function renderWizard() {
    renderWizardStepper();
    renderWizardBody();
    renderWizardFooter();
}

function renderWizardStepper() {
    const el = document.getElementById('wizardStepper');
    let html = '';
    WIZARD_STEPS.forEach((step, i) => {
        if (i > 0) html += '<div class="wizard-step-sep"></div>';
        const cls = i === wizardStep ? 'active' : (i < wizardStep || wizardDone ? 'completed' : '');
        const num = (i < wizardStep || wizardDone) ? '✓' : (i + 1);
        html += `<div class="wizard-step-item ${cls}">
            <span class="wizard-step-num">${num}</span>
            <span>${escapeHtml(step.label)}</span>
        </div>`;
    });
    el.innerHTML = html;
}

function renderWizardFooter() {
    const el = document.getElementById('wizardFooter');
    if (wizardDone) {
        el.innerHTML = `<div></div><button class="btn-primary" onclick="closeWizard()">✓ Close</button>`;
        return;
    }
    const isReview = wizardStep === WIZARD_STEPS.length - 1;
    const backBtn = wizardStep > 0
        ? `<button onclick="wizardBack()">← Back</button>`
        : `<div></div>`;
    const nextBtn = isReview
        ? `<button class="btn-primary" onclick="confirmWizard()">✓ Confirm &amp; Create</button>`
        : `<button class="btn-primary" onclick="wizardNext()">Next →</button>`;
    el.innerHTML = `${backBtn}<div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:0.75rem;color:var(--color-text-muted)">Step ${wizardStep + 1} of ${WIZARD_STEPS.length}</span>
        ${nextBtn}
    </div>`;
}

function captureWizardStepValues(step) {
    if (step === 4) {
        const el = document.getElementById('wizardUniversalULB');
        if (el) wizardData.userBudgets.universalULB = el.value;
    }
    if (step === 5) {
        const budgetEl = document.getElementById('wizardEntBudget');
        const hardStopEl = document.getElementById('wizardEntHardStop');
        const independentEl = document.getElementById('wizardEntIndependent');
        if (budgetEl) wizardData.overageBudgets.enterpriseBudget = parseFloat(budgetEl.value) || 0;
        if (hardStopEl) wizardData.overageBudgets.enterpriseHardStop = hardStopEl.checked;
        if (independentEl) wizardData.overageBudgets.costCenterBudgetsIndependent = independentEl.checked;
    }
}

function wizardBack() {
    captureWizardStepValues(wizardStep);
    if (wizardStep > 0) { wizardStep--; renderWizard(); }
}

function wizardNext() {
    captureWizardStepValues(wizardStep);
    if (wizardStep < WIZARD_STEPS.length - 1) { wizardStep++; renderWizard(); }
}

function renderWizardBody() {
    const el = document.getElementById('wizardBody');
    const renderers = [
        renderWizardStepOrgs, renderWizardStepTeams, renderWizardStepCostCenters,
        renderWizardStepUsers, renderWizardStepUserBudgets,
        renderWizardStepOverageBudgets, renderWizardStepReview
    ];
    el.innerHTML = renderers[wizardStep]();
}

// ─── Wizard Existing Item Edit / Delete ──────────────────────────────────────
function wizardToggleExistingEdit(key) {
    wizardEditingExistingKey = wizardEditingExistingKey === key ? null : key;
    renderWizardBody();
}

function wizardSaveExistingOrg(id) {
    const org = state.orgs.find(o => o.id === id);
    if (!org) return;
    const newName = (document.getElementById('wzeOrgName_' + id) || {}).value?.trim() || '';
    const errEl = document.getElementById('wzeOrgErr_' + id);
    if (!newName) { if (errEl) errEl.textContent = 'Name is required.'; return; }
    if (state.orgs.some(o => o.name === newName && o.id !== id)) { if (errEl) errEl.textContent = `"${newName}" already exists.`; return; }
    const oldName = org.name;
    org.name = newName;
    if (oldName !== newName) wizardData.costCenters.forEach(cc => { if (cc.orgNames) cc.orgNames = cc.orgNames.map(n => n === oldName ? newName : n); });
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

function wizardDeleteExistingOrg(id) {
    const org = state.orgs.find(o => o.id === id);
    if (!org || !confirm(`Delete organization "${org.name}"? Users and cost centers will be unlinked.`)) return;
    state.orgs = state.orgs.filter(o => o.id !== id);
    state.users.forEach(u => { if (u.orgId === id) u.orgId = null; });
    state.costCenters.forEach(cc => { if (cc.orgIds) cc.orgIds = cc.orgIds.filter(oid => oid !== id); });
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

function wizardSaveExistingTeam(id) {
    const team = state.teams.find(t => t.id === id);
    if (!team) return;
    const newName = (document.getElementById('wzeTeamName_' + id) || {}).value?.trim() || '';
    const errEl = document.getElementById('wzeTeamErr_' + id);
    if (!newName) { if (errEl) errEl.textContent = 'Name is required.'; return; }
    if (state.teams.some(t => t.name === newName && t.id !== id)) { if (errEl) errEl.textContent = `"${newName}" already exists.`; return; }
    const oldName = team.name;
    team.name = newName;
    if (oldName !== newName) wizardData.costCenters.forEach(cc => { if (cc.teamNames) cc.teamNames = cc.teamNames.map(n => n === oldName ? newName : n); });
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

function wizardDeleteExistingTeam(id) {
    const team = state.teams.find(t => t.id === id);
    if (!team || !confirm(`Delete team "${team.name}"? Users and cost centers will be unlinked.`)) return;
    state.teams = state.teams.filter(t => t.id !== id);
    state.users.forEach(u => { if (u.teamId === id) u.teamId = null; });
    state.costCenters.forEach(cc => { if (cc.teamIds) cc.teamIds = cc.teamIds.filter(tid => tid !== id); if (cc.teamId === id) cc.teamId = null; });
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

function wizardSaveExistingCC(id) {
    const cc = state.costCenters.find(c => c.id === id);
    if (!cc) return;
    const newName = (document.getElementById('wzeCCName_' + id) || {}).value?.trim() || '';
    const errEl = document.getElementById('wzeCCErr_' + id);
    if (!newName) { if (errEl) errEl.textContent = 'Name is required.'; return; }
    if (state.costCenters.some(c => c.name === newName && c.id !== id)) { if (errEl) errEl.textContent = `"${newName}" already exists.`; return; }
    const teamSel = document.getElementById('wzeCCTeams_' + id);
    const orgSel = document.getElementById('wzeCCOrgs_' + id);
    cc.name = newName;
    if (teamSel) { cc.teamIds = Array.from(teamSel.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value); cc.teamId = cc.teamIds[0] || null; }
    if (orgSel) cc.orgIds = Array.from(orgSel.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

function wizardDeleteExistingCC(id) {
    const cc = state.costCenters.find(c => c.id === id);
    if (!cc || !confirm(`Delete cost center "${cc.name}"? Users assigned to it will be unlinked.`)) return;
    state.costCenters = state.costCenters.filter(c => c.id !== id);
    state.users.forEach(u => { if (u.costCenterId === id) u.costCenterId = null; });
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

function wizardSaveExistingUser(id) {
    const user = state.users.find(u => u.id === id);
    if (!user) return;
    const ccSel = document.getElementById('wzeUserCC_' + id);
    const orgSel = document.getElementById('wzeUserOrg_' + id);
    const teamSel = document.getElementById('wzeUserTeam_' + id);
    const licSel = document.getElementById('wzeUserLic_' + id);
    if (ccSel) user.costCenterId = ccSel.value || null;
    if (orgSel) user.orgId = orgSel.value || null;
    if (teamSel) user.teamId = teamSel.value || null;
    if (licSel) user.license = licSel.value;
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

function wizardDeleteExistingUser(id) {
    const user = state.users.find(u => u.id === id);
    if (!user || !confirm(`Delete user "${user.name}"?`)) return;
    state.users = state.users.filter(u => u.id !== id);
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

function wizardSaveExistingULB(type, id) {
    const errEl = document.getElementById('wzeULBErr_' + type + '_' + id);
    const newValDollars = parseFloat((document.getElementById('wzeULBVal_' + type + '_' + id) || {}).value);
    if (!Number.isFinite(newValDollars) || newValDollars < 0) { if (errEl) errEl.textContent = 'Enter a valid budget (≥ $0).'; return; }
    const newVal = dollarsToCredits(newValDollars);
    if (type === 'universal') state.enterprise.universalULB = newVal;
    else if (type === 'user') { const u = state.users.find(u => u.id === id); if (u) u.individualULB = newVal; }
    else if (type === 'cc') { const c = state.costCenters.find(c => c.id === id); if (c) c.ulb = newVal; }
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

function wizardDeleteExistingULB(type, id) {
    if (type === 'universal') { if (!confirm('Remove universal ULB?')) return; state.enterprise.universalULB = null; }
    else if (type === 'user') { const u = state.users.find(u => u.id === id); if (!u || !confirm(`Remove individual ULB for "${u.name}"?`)) return; u.individualULB = null; }
    else if (type === 'cc') { const c = state.costCenters.find(c => c.id === id); if (!c || !confirm(`Remove ULB for cost center "${c.name}"?`)) return; c.ulb = null; }
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

function wizardSaveExistingOverage(type, id) {
    const errEl = document.getElementById('wzeOverageErr_' + type + '_' + id);
    const newVal = parseFloat((document.getElementById('wzeOverageVal_' + type + '_' + id) || {}).value);
    if (isNaN(newVal) || newVal < 0) { if (errEl) errEl.textContent = 'Enter a valid budget (≥ $0).'; return; }
    const hardStop = (document.getElementById('wzeOverageHS_' + type + '_' + id) || {}).checked ?? true;
    if (type === 'enterprise') {
        const independent = !!((document.getElementById('wzeOverageIndep_' + type + '_' + id) || {}).checked);
        state.enterprise.enterpriseBudget = newVal;
        state.enterprise.enterpriseHardStop = hardStop;
        setCostCenterBudgetsIndependent(independent);
        wizardData.overageBudgets.enterpriseBudget = newVal;
        wizardData.overageBudgets.enterpriseHardStop = hardStop;
        wizardData.overageBudgets.costCenterBudgetsIndependent = independent;
    }
    else if (type === 'org') { const o = state.orgs.find(o => o.id === id); if (o) { o.budget = newVal; o.budgetHardStop = hardStop; } }
    else if (type === 'cc') { const c = state.costCenters.find(c => c.id === id); if (c) { c.budget = newVal; c.budgetHardStop = hardStop; } }
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

function wizardDeleteExistingOverage(type, id) {
    if (type === 'enterprise') { if (!confirm('Reset enterprise overage budget to 0?')) return; state.enterprise.enterpriseBudget = 0; }
    else if (type === 'org') { const o = state.orgs.find(o => o.id === id); if (!o || !confirm(`Remove overage budget for "${o.name}"?`)) return; o.budget = null; o.budgetHardStop = true; }
    else if (type === 'cc') { const c = state.costCenters.find(c => c.id === id); if (!c || !confirm(`Remove overage budget for "${c.name}"?`)) return; c.budget = null; c.budgetHardStop = true; }
    saveState(); wizardEditingExistingKey = null; renderWizardBody();
}

// ─── Wizard Step 1: Organizations ─────────────────────────────────────────────
function wizardAddOrg() {
    const input = document.getElementById('wizardOrgName');
    const name = input.value.trim();
    const errEl = document.getElementById('wizardOrgError');
    if (!name) { errEl.textContent = 'Organization name is required.'; return; }
    if (wizardData.orgs.some(o => o.name === name)) { errEl.textContent = `"${name}" is already in this list.`; return; }
    if (state.orgs.some(o => o.name === name)) { errEl.textContent = `"${name}" already exists in the simulator.`; return; }
    wizardData.orgs.push({ name });
    input.value = '';
    errEl.textContent = '';
    renderWizardOrgList();
}

function wizardRemoveOrg(name) {
    wizardData.orgs = wizardData.orgs.filter(o => o.name !== name);
    wizardData.costCenters.forEach(cc => { cc.orgNames = (cc.orgNames || []).filter(n => n !== name); });
    wizardData.overageBudgets.orgs = wizardData.overageBudgets.orgs.filter(b => b.orgName !== name);
    renderWizardOrgList();
}

function renderWizardOrgList() {
    const el = document.getElementById('wizardOrgList');
    if (!el) return;
    if (wizardData.orgs.length === 0) { el.innerHTML = '<p class="help-text">No organizations added yet.</p>'; return; }
    el.innerHTML = '<div class="wizard-entry-list">' + wizardData.orgs.map(o =>
        `<div class="wizard-entry-item"><div class="wizard-entry-item-info"><strong>${escapeHtml(o.name)}</strong></div>
        <button type="button" class="btn-danger btn-sm" onclick="wizardRemoveOrg('${escapeInlineArg(o.name)}')">✕</button></div>`
    ).join('') + '</div>';
}

function renderWizardStepOrgs() {
    const existingOrgs = state.orgs;
    const existingHtml = existingOrgs.length > 0
        ? `<div class="wizard-existing-section">
            <h4>Already in Simulator (${existingOrgs.length})</h4>
            <div class="wizard-entry-list">` +
            existingOrgs.map(o => {
                const key = 'org:' + o.id;
                const isEditing = wizardEditingExistingKey === key;
                const row = `<div class="wizard-entry-item existing${isEditing ? ' editing' : ''}">
                    <div class="wizard-entry-item-info"><strong>${escapeHtml(o.name)}</strong></div>
                    <div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="btn-sm" onclick="wizardToggleExistingEdit('${escapeInlineArg(key)}')">✏️ Edit</button><button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingOrg('${escapeInlineArg(o.id)}')">🗑 Delete</button></div></div>`;
                if (!isEditing) return row;
                return row + `<div class="wizard-existing-edit-form">
                    <div class="form-row" style="margin-bottom:8px">
                        <div class="form-group" style="flex:1"><label>Organization Name</label>
                            <input type="text" id="wzeOrgName_${escapeHtml(o.id)}" value="${escapeHtml(o.name)}"></div>
                    </div>
                    <div id="wzeOrgErr_${escapeHtml(o.id)}" class="wizard-error"></div>
                    <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingOrg('${escapeInlineArg(o.id)}')">🗑 Delete</button>
                        <button type="button" class="btn-primary btn-sm" onclick="wizardSaveExistingOrg('${escapeInlineArg(o.id)}')">✓ Save</button>
                    </div></div>`;
            }).join('') + `</div></div>` : '';
    const listHtml = wizardData.orgs.length === 0
        ? '<p class="help-text">No organizations added yet.</p>'
        : '<div class="wizard-entry-list">' + wizardData.orgs.map(o =>
            `<div class="wizard-entry-item"><div class="wizard-entry-item-info"><strong>${escapeHtml(o.name)}</strong></div>
            <button type="button" class="btn-danger btn-sm" onclick="wizardRemoveOrg('${escapeInlineArg(o.name)}')">✕</button></div>`
        ).join('') + '</div>';
    return `<h3>Step 1: Organizations</h3>
        <p class="help-text" style="margin-bottom:16px">Add the GitHub organizations in your enterprise. These group users and scope overage budgets.</p>
        <form onsubmit="event.preventDefault(); wizardAddOrg()">
            <div class="inline-form">
                <div class="form-group" style="flex:1"><label>Organization Name</label>
                    <input type="text" id="wizardOrgName" placeholder="e.g., acme-corp"></div>
                <button type="submit" class="btn-primary">+ Add</button>
            </div>
            <div class="wizard-error" id="wizardOrgError"></div>
        </form>
        <div id="wizardOrgList">${listHtml}</div>
        ${existingHtml}`;
}

// ─── Wizard Step 2: Enterprise Teams ──────────────────────────────────────────
function wizardAddTeam() {
    const input = document.getElementById('wizardTeamName');
    const name = input.value.trim();
    const errEl = document.getElementById('wizardTeamError');
    if (!name) { errEl.textContent = 'Team name is required.'; return; }
    if (wizardData.teams.some(t => t.name === name)) { errEl.textContent = `"${name}" is already in this list.`; return; }
    if (state.teams.some(t => t.name === name)) { errEl.textContent = `"${name}" already exists in the simulator.`; return; }
    wizardData.teams.push({ name });
    input.value = '';
    errEl.textContent = '';
    renderWizardTeamList();
}

function wizardRemoveTeam(name) {
    wizardData.teams = wizardData.teams.filter(t => t.name !== name);
    wizardData.costCenters.forEach(cc => { cc.teamNames = (cc.teamNames || []).filter(n => n !== name); });
    wizardData.users.forEach(u => { if (u.teamName === name) u.teamName = ''; });
    renderWizardTeamList();
}

function renderWizardTeamList() {
    const el = document.getElementById('wizardTeamList');
    if (!el) return;
    if (wizardData.teams.length === 0) { el.innerHTML = '<p class="help-text">No teams added yet.</p>'; return; }
    el.innerHTML = '<div class="wizard-entry-list">' + wizardData.teams.map(t =>
        `<div class="wizard-entry-item"><div class="wizard-entry-item-info"><strong>${escapeHtml(t.name)}</strong></div>
        <button type="button" class="btn-danger btn-sm" onclick="wizardRemoveTeam('${escapeInlineArg(t.name)}')">✕</button></div>`
    ).join('') + '</div>';
}

function renderWizardStepTeams() {
    const existingTeams = state.teams;
    const existingHtml = existingTeams.length > 0
        ? `<div class="wizard-existing-section">
            <h4>Already in Simulator (${existingTeams.length})</h4>
            <div class="wizard-entry-list">` +
            existingTeams.map(t => {
                const key = 'team:' + t.id;
                const isEditing = wizardEditingExistingKey === key;
                const row = `<div class="wizard-entry-item existing${isEditing ? ' editing' : ''}">
                    <div class="wizard-entry-item-info"><strong>${escapeHtml(t.name)}</strong></div>
                    <div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="btn-sm" onclick="wizardToggleExistingEdit('${escapeInlineArg(key)}')">✏️ Edit</button><button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingTeam('${escapeInlineArg(t.id)}')">🗑 Delete</button></div></div>`;
                if (!isEditing) return row;
                return row + `<div class="wizard-existing-edit-form">
                    <div class="form-row" style="margin-bottom:8px">
                        <div class="form-group" style="flex:1"><label>Team Name</label>
                            <input type="text" id="wzeTeamName_${escapeHtml(t.id)}" value="${escapeHtml(t.name)}"></div>
                    </div>
                    <div id="wzeTeamErr_${escapeHtml(t.id)}" class="wizard-error"></div>
                    <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingTeam('${escapeInlineArg(t.id)}')">🗑 Delete</button>
                        <button type="button" class="btn-primary btn-sm" onclick="wizardSaveExistingTeam('${escapeInlineArg(t.id)}')">✓ Save</button>
                    </div></div>`;
            }).join('') + `</div></div>` : '';
    const listHtml = wizardData.teams.length === 0
        ? '<p class="help-text">No teams added yet.</p>'
        : '<div class="wizard-entry-list">' + wizardData.teams.map(t =>
            `<div class="wizard-entry-item"><div class="wizard-entry-item-info"><strong>${escapeHtml(t.name)}</strong></div>
            <button type="button" class="btn-danger btn-sm" onclick="wizardRemoveTeam('${escapeInlineArg(t.name)}')">✕</button></div>`
        ).join('') + '</div>';
    return `<h3>Step 2: Enterprise Teams</h3>
        <p class="help-text" style="margin-bottom:16px">Add teams that group users within your enterprise. Teams can be assigned to cost centers.</p>
        <form onsubmit="event.preventDefault(); wizardAddTeam()">
            <div class="inline-form">
                <div class="form-group" style="flex:1"><label>Team Name</label>
                    <input type="text" id="wizardTeamName" placeholder="e.g., engineers"></div>
                <button type="submit" class="btn-primary">+ Add</button>
            </div>
            <div class="wizard-error" id="wizardTeamError"></div>
        </form>
        <div id="wizardTeamList">${listHtml}</div>
        ${existingHtml}`;
}

// ─── Wizard Step 3: Cost Centers ──────────────────────────────────────────────
function wizardAddCostCenter() {
    const nameInput = document.getElementById('wizardCCName');
    const name = nameInput.value.trim();
    const errEl = document.getElementById('wizardCCError');
    if (!name) { errEl.textContent = 'Cost center name is required.'; return; }
    if (wizardData.costCenters.some(cc => cc.name === name)) { errEl.textContent = `"${name}" is already in this list.`; return; }
    if (state.costCenters.some(cc => cc.name === name)) { errEl.textContent = `"${name}" already exists in the simulator.`; return; }
    const teamSel = document.getElementById('wizardCCTeams');
    const orgSel = document.getElementById('wizardCCOrgs');
    const teamNames = teamSel ? Array.from(teamSel.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value) : [];
    const orgNames = orgSel ? Array.from(orgSel.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value) : [];
    wizardData.costCenters.push({ name, teamNames, orgNames });
    nameInput.value = '';
    if (teamSel) teamSel.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
    if (orgSel) orgSel.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
    errEl.textContent = '';
    renderWizardCCList();
}

function wizardRemoveCC(name) {
    wizardData.costCenters = wizardData.costCenters.filter(cc => cc.name !== name);
    wizardData.users.forEach(u => { if (u.ccName === name) u.ccName = ''; });
    wizardData.userBudgets.costCenter = wizardData.userBudgets.costCenter.filter(b => b.ccName !== name);
    wizardData.overageBudgets.costCenters = wizardData.overageBudgets.costCenters.filter(b => b.ccName !== name);
    renderWizardCCList();
}

function renderWizardCCList() {
    const el = document.getElementById('wizardCCList');
    if (!el) return;
    if (wizardData.costCenters.length === 0) { el.innerHTML = '<p class="help-text">No cost centers added yet.</p>'; return; }
    el.innerHTML = '<div class="wizard-entry-list">' + wizardData.costCenters.map(cc => {
        const parts = [];
        if (cc.teamNames && cc.teamNames.length > 0) parts.push(`Teams: ${cc.teamNames.join(', ')}`);
        if (cc.orgNames && cc.orgNames.length > 0) parts.push(`Orgs: ${cc.orgNames.join(', ')}`);
        return `<div class="wizard-entry-item">
            <div class="wizard-entry-item-info"><strong>${escapeHtml(cc.name)}</strong>
                ${parts.length > 0 ? `<div class="help-text">${escapeHtml(parts.join(' · '))}</div>` : ''}
            </div>
            <button type="button" class="btn-danger btn-sm" onclick="wizardRemoveCC('${escapeInlineArg(cc.name)}')">✕</button></div>`;
    }).join('') + '</div>';
}

function renderWizardStepCostCenters() {
    const allTeams = [...state.teams.map(t => t.name), ...wizardData.teams.map(t => t.name)];
    const allOrgs = [...state.orgs.map(o => o.name), ...wizardData.orgs.map(o => o.name)];
    const allTeamsForWizard = allTeams;
    const allOrgsForWizard = allOrgs;
    const listHtml = wizardData.costCenters.length === 0
        ? '<p class="help-text">No cost centers added yet.</p>'
        : '<div class="wizard-entry-list">' + wizardData.costCenters.map(cc => {
            const parts = [];
            if (cc.teamNames && cc.teamNames.length > 0) parts.push(`Teams: ${cc.teamNames.join(', ')}`);
            if (cc.orgNames && cc.orgNames.length > 0) parts.push(`Orgs: ${cc.orgNames.join(', ')}`);
            return `<div class="wizard-entry-item">
                <div class="wizard-entry-item-info"><strong>${escapeHtml(cc.name)}</strong>
                    ${parts.length > 0 ? `<div class="help-text">${escapeHtml(parts.join(' · '))}</div>` : ''}
                </div>
                <button type="button" class="btn-danger btn-sm" onclick="wizardRemoveCC('${escapeInlineArg(cc.name)}')">✕</button></div>`;
        }).join('') + '</div>';
    const existingCCs = state.costCenters;
    const existingHtml = existingCCs.length > 0
        ? `<div class="wizard-existing-section">
            <h4>Already in Simulator (${existingCCs.length})</h4>
            <div class="wizard-entry-list">` +
            existingCCs.map(cc => {
                const key = 'cc:' + cc.id;
                const isEditing = wizardEditingExistingKey === key;
                const teams = state.teams.filter(t => (cc.teamIds || []).includes(t.id));
                const orgs = state.orgs.filter(o => (cc.orgIds || []).includes(o.id));
                const parts = [];
                if (teams.length > 0) parts.push(`Teams: ${teams.map(t => t.name).join(', ')}`);
                if (orgs.length > 0) parts.push(`Orgs: ${orgs.map(o => o.name).join(', ')}`);
                const row = `<div class="wizard-entry-item existing${isEditing ? ' editing' : ''}">
                    <div class="wizard-entry-item-info"><strong>${escapeHtml(cc.name)}</strong>
                        ${parts.length > 0 ? `<div class="help-text">${escapeHtml(parts.join(' · '))}</div>` : ''}</div>
                    <div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="btn-sm" onclick="wizardToggleExistingEdit('${escapeInlineArg(key)}')">✏️ Edit</button><button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingCC('${escapeInlineArg(cc.id)}')">🗑 Delete</button></div></div>`;
                if (!isEditing) return row;
                return row + `<div class="wizard-existing-edit-form">
                    <div class="form-row" style="margin-bottom:8px">
                        <div class="form-group" style="flex:1"><label>Cost Center Name</label>
                            <input type="text" id="wzeCCName_${escapeHtml(cc.id)}" value="${escapeHtml(cc.name)}"></div>
                        ${state.teams.length > 0 ? `<div class="form-group"><label>Teams</label>
                            <div class="wizard-checkbox-list" id="wzeCCTeams_${escapeHtml(cc.id)}">${state.teams.map(t => `<label class="checkbox-label"><input type="checkbox" value="${escapeHtml(t.id)}"${(cc.teamIds || []).includes(t.id) ? ' checked' : ''}> ${escapeHtml(t.name)}</label>`).join('')}</div></div>` : ''}
                        ${state.orgs.length > 0 ? `<div class="form-group"><label>Organizations</label>
                            <div class="wizard-checkbox-list" id="wzeCCOrgs_${escapeHtml(cc.id)}">${state.orgs.map(o => `<label class="checkbox-label"><input type="checkbox" value="${escapeHtml(o.id)}"${(cc.orgIds || []).includes(o.id) ? ' checked' : ''}> ${escapeHtml(o.name)}</label>`).join('')}</div></div>` : ''}
                    </div>
                    <div id="wzeCCErr_${escapeHtml(cc.id)}" class="wizard-error"></div>
                    <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingCC('${escapeInlineArg(cc.id)}')">🗑 Delete</button>
                        <button type="button" class="btn-primary btn-sm" onclick="wizardSaveExistingCC('${escapeInlineArg(cc.id)}')">✓ Save</button>
                    </div></div>`;
            }).join('') + `</div></div>` : '';
    return `<h3>Step 3: Cost Centers</h3>
        <p class="help-text" style="margin-bottom:16px">Create cost centers and assign teams and organizations to them. Cost centers enable AI credit pool reservations and scoped budgets.</p>
        <form onsubmit="event.preventDefault(); wizardAddCostCenter()">
            <div class="form-row">
                <div class="form-group"><label>Cost Center Name</label>
                    <input type="text" id="wizardCCName" placeholder="e.g., Engineering"></div>
                ${allTeams.length > 0 ? `<div class="form-group"><label>Teams</label>
                    <div class="wizard-checkbox-list" id="wizardCCTeams">${allTeamsForWizard.map(n => `<label class="checkbox-label"><input type="checkbox" value="${escapeHtml(n)}"> ${escapeHtml(n)}</label>`).join('')}</div></div>` : ''}
                ${allOrgs.length > 0 ? `<div class="form-group"><label>Organizations</label>
                    <div class="wizard-checkbox-list" id="wizardCCOrgs">${allOrgsForWizard.map(n => `<label class="checkbox-label"><input type="checkbox" value="${escapeHtml(n)}"> ${escapeHtml(n)}</label>`).join('')}</div></div>` : ''}
            </div>
            <div style="margin-top:8px"><button type="submit" class="btn-primary">+ Add Cost Center</button></div>
            <div class="wizard-error" id="wizardCCError"></div>
        </form>
        <div id="wizardCCList">${listHtml}</div>
        ${existingHtml}`;
}

// ─── Wizard Step 4: Users ─────────────────────────────────────────────────────
function wizardAddUser() {
    const mode = document.getElementById('wizardUserMode').value;
    const errEl = document.getElementById('wizardUserError');
    const ccName = document.getElementById('wizardUserCC').value;
    const orgName = document.getElementById('wizardUserOrg').value;
    const teamName = document.getElementById('wizardUserTeam').value;
    const license = document.getElementById('wizardUserLicense').value;

    if (mode === 'bulk') {
        const count = parseInt(document.getElementById('wizardBulkCount').value) || 0;
        const prefix = document.getElementById('wizardBulkPrefix').value.trim() || 'user';
        if (count <= 0 || count > MAX_BULK_USER_COUNT) { errEl.textContent = `Enter a number between 1 and ${MAX_BULK_USER_COUNT}.`; return; }
        const prefixPattern = new RegExp(`^${escapeRegexPattern(prefix)}-(\\d+)$`);
        const existingNums = [...state.users, ...wizardData.users]
            .map(u => { const m = u.name.match(prefixPattern); return m ? parseInt(m[1]) : 0; })
            .filter(n => n > 0);
        let nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
        for (let i = 0; i < count; i++) {
            const name = `${prefix}-${nextNum + i}`;
            if (!state.users.some(u => u.name === name) && !wizardData.users.some(u => u.name === name)) {
                wizardData.users.push({ name, license, ccName, orgName, teamName });
            }
        }
        errEl.textContent = '';
    } else {
        const name = document.getElementById('wizardUserName').value.trim();
        if (!name) { errEl.textContent = 'Username is required.'; return; }
        if (wizardData.users.some(u => u.name === name)) { errEl.textContent = `"${name}" is already in this list.`; return; }
        if (state.users.some(u => u.name === name)) { errEl.textContent = `"${name}" already exists in the simulator.`; return; }
        wizardData.users.push({ name, license, ccName, orgName, teamName });
        document.getElementById('wizardUserName').value = '';
        errEl.textContent = '';
    }
    renderWizardUserList();
}

function wizardRemoveUser(name) {
    wizardData.users = wizardData.users.filter(u => u.name !== name);
    wizardData.userBudgets.individual = wizardData.userBudgets.individual.filter(b => b.userName !== name);
    renderWizardUserList();
}

function wizardUpdateUserMode() {
    const isSingle = document.getElementById('wizardUserMode').value === 'single';
    document.getElementById('wizardSingleFields').hidden = !isSingle;
    document.getElementById('wizardBulkFields').hidden = isSingle;
    const btn = document.getElementById('wizardUserAddBtn');
    if (btn) btn.textContent = isSingle ? '+ Add User' : '⚡ Generate Users';
}

function renderWizardUserList() {
    const el = document.getElementById('wizardUserList');
    if (!el) return;
    if (wizardData.users.length === 0) { el.innerHTML = '<p class="help-text">No users added yet.</p>'; return; }
    el.innerHTML = `<p class="help-text" style="margin-bottom:6px">${wizardData.users.length} user(s) added.</p>` +
        '<div class="wizard-entry-list">' + wizardData.users.map(u => {
            const meta = [u.license, u.ccName && `CC: ${u.ccName}`, u.orgName && `Org: ${u.orgName}`, u.teamName && `Team: ${u.teamName}`].filter(Boolean).join(' · ');
            return `<div class="wizard-entry-item">
                <div class="wizard-entry-item-info"><strong>${escapeHtml(u.name)}</strong>
                    <div class="help-text">${escapeHtml(meta)}</div></div>
                <button type="button" class="btn-danger btn-sm" onclick="wizardRemoveUser('${escapeInlineArg(u.name)}')">✕</button></div>`;
        }).join('') + '</div>';
}

function renderWizardStepUsers() {
    const allCC = [...state.costCenters.map(c => c.name), ...wizardData.costCenters.map(c => c.name)];
    const allOrgs = [...state.orgs.map(o => o.name), ...wizardData.orgs.map(o => o.name)];
    const allTeams = [...state.teams.map(t => t.name), ...wizardData.teams.map(t => t.name)];
    const ccOpts = '<option value="">(None)</option>' + allCC.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    const orgOpts = '<option value="">(None)</option>' + allOrgs.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    const teamOpts = '<option value="">(None)</option>' + allTeams.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    const listHtml = wizardData.users.length === 0
        ? '<p class="help-text">No users added yet.</p>'
        : `<p class="help-text" style="margin-bottom:6px">${wizardData.users.length} user(s) added.</p>` +
          '<div class="wizard-entry-list">' + wizardData.users.map(u => {
            const meta = [u.license, u.ccName && `CC: ${u.ccName}`, u.orgName && `Org: ${u.orgName}`, u.teamName && `Team: ${u.teamName}`].filter(Boolean).join(' · ');
            return `<div class="wizard-entry-item">
                <div class="wizard-entry-item-info"><strong>${escapeHtml(u.name)}</strong>
                    <div class="help-text">${escapeHtml(meta)}</div></div>
                <button type="button" class="btn-danger btn-sm" onclick="wizardRemoveUser('${escapeInlineArg(u.name)}')">✕</button></div>`;
          }).join('') + '</div>';
    const existingUsers = state.users;
    const existingHtml = existingUsers.length > 0
        ? `<div class="wizard-existing-section">
            <h4>Already in Simulator (${existingUsers.length})</h4>
            <div class="wizard-entry-list">` +
            existingUsers.map(u => {
                const cc = state.costCenters.find(c => c.id === u.costCenterId);
                const org = state.orgs.find(o => o.id === u.orgId);
                const team = state.teams.find(t => t.id === u.teamId);
                const meta = [u.license, cc && `CC: ${cc.name}`, org && `Org: ${org.name}`, team && `Team: ${team.name}`].filter(Boolean).join(' · ');
                const key = 'user:' + u.id;
                const isEditing = wizardEditingExistingKey === key;
                const ccEditOpts = '<option value="">(None)</option>' + state.costCenters.map(c => `<option value="${escapeHtml(c.id)}"${u.costCenterId === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
                const orgEditOpts = '<option value="">(None)</option>' + state.orgs.map(o => `<option value="${escapeHtml(o.id)}"${u.orgId === o.id ? ' selected' : ''}>${escapeHtml(o.name)}</option>`).join('');
                const teamEditOpts = '<option value="">(None)</option>' + state.teams.map(t => `<option value="${escapeHtml(t.id)}"${u.teamId === t.id ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
                const row = `<div class="wizard-entry-item existing${isEditing ? ' editing' : ''}">
                    <div class="wizard-entry-item-info"><strong>${escapeHtml(u.name)}</strong>
                        <div class="help-text">${escapeHtml(meta)}</div></div>
                    <div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="btn-sm" onclick="wizardToggleExistingEdit('${escapeInlineArg(key)}')">✏️ Edit</button><button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingUser('${escapeInlineArg(u.id)}')">🗑 Delete</button></div></div>`;
                if (!isEditing) return row;
                return row + `<div class="wizard-existing-edit-form">
                    <div class="form-row" style="margin-bottom:8px">
                        <div class="form-group"><label>License</label>
                            <select id="wzeUserLic_${escapeHtml(u.id)}">
                                <option value="business"${u.license !== 'enterprise' ? ' selected' : ''}>Business</option>
                                <option value="enterprise"${u.license === 'enterprise' ? ' selected' : ''}>Enterprise</option>
                            </select></div>
                        <div class="form-group"><label>Cost Center</label>
                            <select id="wzeUserCC_${escapeHtml(u.id)}">${ccEditOpts}</select></div>
                        <div class="form-group"><label>Organization</label>
                            <select id="wzeUserOrg_${escapeHtml(u.id)}">${orgEditOpts}</select></div>
                        <div class="form-group"><label>Team</label>
                            <select id="wzeUserTeam_${escapeHtml(u.id)}">${teamEditOpts}</select></div>
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingUser('${escapeInlineArg(u.id)}')">🗑 Delete</button>
                        <button type="button" class="btn-primary btn-sm" onclick="wizardSaveExistingUser('${escapeInlineArg(u.id)}')">✓ Save</button>
                    </div></div>`;
            }).join('') + `</div></div>` : '';
    return `<h3>Step 4: Users</h3>
        <p class="help-text" style="margin-bottom:16px">Add individual users or generate multiple in bulk. Assign each user a license, cost center, organization, and team.</p>
        <form onsubmit="event.preventDefault(); wizardAddUser()">
            <div class="form-row">
                <div class="form-group"><label>Creation Mode</label>
                    <select id="wizardUserMode" onchange="wizardUpdateUserMode()">
                        <option value="single">Single user</option>
                        <option value="bulk">Bulk users</option>
                    </select></div>
                <div id="wizardSingleFields" class="form-group"><label>Username</label>
                    <input type="text" id="wizardUserName" placeholder="e.g., alice"></div>
                <div id="wizardBulkFields" class="form-group" hidden><label>Count &amp; Prefix</label>
                    <div style="display:flex;gap:6px">
                        <input type="number" id="wizardBulkCount" value="10" min="1" max="500" style="width:72px">
                        <input type="text" id="wizardBulkPrefix" value="user" placeholder="prefix" style="flex:1">
                    </div></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>License</label>
                    <select id="wizardUserLicense"><option value="business">Business</option><option value="enterprise">Enterprise</option></select></div>
                <div class="form-group"><label>Cost Center</label><select id="wizardUserCC">${ccOpts}</select></div>
                <div class="form-group"><label>Organization</label><select id="wizardUserOrg">${orgOpts}</select></div>
                <div class="form-group"><label>Team</label><select id="wizardUserTeam">${teamOpts}</select></div>
            </div>
            <div style="margin-top:8px">
                <button type="submit" id="wizardUserAddBtn" class="btn-primary">+ Add User</button></div>
            <div class="wizard-error" id="wizardUserError"></div>
        </form>
        <div id="wizardUserList">${listHtml}</div>
        ${existingHtml}`;
}

// ─── Wizard Step 5: User-Level Budgets ────────────────────────────────────────
function wizardUpdateULBTargets() {
    const typeEl = document.getElementById('wizardULBType');
    const targetEl = document.getElementById('wizardULBTarget');
    if (!typeEl || !targetEl) return;
    const type = typeEl.value;
    if (type === 'individual') {
        const used = new Set(wizardData.userBudgets.individual.map(b => b.userName));
        const allUsers = [
            ...state.users.filter(u => u.individualULB === null && !used.has(u.name)).map(u => u.name),
            ...wizardData.users.filter(u => !used.has(u.name)).map(u => u.name)
        ];
        targetEl.innerHTML = allUsers.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    } else {
        const used = new Set(wizardData.userBudgets.costCenter.map(b => b.ccName));
        const allCCs = [
            ...state.costCenters.filter(cc => cc.ulb === null && !used.has(cc.name)).map(cc => cc.name),
            ...wizardData.costCenters.filter(cc => !used.has(cc.name)).map(cc => cc.name)
        ];
        targetEl.innerHTML = allCCs.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    }
}

function wizardAddUserBudget() {
    const type = document.getElementById('wizardULBType').value;
    const target = document.getElementById('wizardULBTarget').value;
    const valueDollars = parseFloat(document.getElementById('wizardULBValue').value);
    const value = Number.isFinite(valueDollars) ? dollarsToCredits(valueDollars) : NaN;
    const errEl = document.getElementById('wizardULBError');
    if (!target) { errEl.textContent = 'Select a target.'; return; }
    if (isNaN(value) || value < 0) { errEl.textContent = 'Enter a valid budget (≥ $0).'; return; }
    if (type === 'individual') {
        if (wizardData.userBudgets.individual.some(b => b.userName === target)) { errEl.textContent = `"${target}" already has a budget.`; return; }
        wizardData.userBudgets.individual.push({ userName: target, budget: value });
    } else {
        if (wizardData.userBudgets.costCenter.some(b => b.ccName === target)) { errEl.textContent = `"${target}" already has a budget.`; return; }
        wizardData.userBudgets.costCenter.push({ ccName: target, budget: value });
    }
    document.getElementById('wizardULBValue').value = '';
    errEl.textContent = '';
    renderWizardULBList();
    wizardUpdateULBTargets();
}

function wizardRemoveUserBudget(type, target) {
    if (type === 'individual') wizardData.userBudgets.individual = wizardData.userBudgets.individual.filter(b => b.userName !== target);
    else wizardData.userBudgets.costCenter = wizardData.userBudgets.costCenter.filter(b => b.ccName !== target);
    renderWizardULBList();
    wizardUpdateULBTargets();
}

function wizardULBListHtml() {
    const items = [
        ...wizardData.userBudgets.costCenter.map(b => ({ type: 'costcenter', target: b.ccName, budget: b.budget })),
        ...wizardData.userBudgets.individual.map(b => ({ type: 'individual', target: b.userName, budget: b.budget }))
    ];
    if (items.length === 0) return '<p class="help-text">No user-level budgets added yet.</p>';
    return '<div class="wizard-entry-list">' + items.map(b =>
        `<div class="wizard-entry-item"><div class="wizard-entry-item-info">
            <strong>${escapeHtml(b.target)}</strong>
            <span class="badge ${b.type === 'individual' ? 'badge-warning' : 'badge-info'}" style="margin-left:6px">${b.type === 'individual' ? 'Individual' : 'Cost Center'}</span>
            <span style="margin-left:6px;font-size:0.875rem">${formatBudgetWithCreditReferenceFromCredits(b.budget)}</span>
        </div><button type="button" class="btn-danger btn-sm" onclick="wizardRemoveUserBudget('${escapeInlineArg(b.type)}','${escapeInlineArg(b.target)}')">✕</button></div>`
    ).join('') + '</div>';
}

function renderWizardULBList() {
    const el = document.getElementById('wizardULBList');
    if (el) el.innerHTML = wizardULBListHtml();
}

function renderWizardStepUserBudgets() {
    const allUsers = [...state.users.filter(u => u.individualULB === null).map(u => u.name), ...wizardData.users.map(u => u.name)];
    const targetOpts = allUsers.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    const universalVal = wizardData.userBudgets.universalULB !== null ? String(wizardData.userBudgets.universalULB) : '';

    // Existing ULBs from state
    const existingULBItems = [];
    if (state.enterprise.universalULB !== null) {
        const key = 'ulb:universal:_';
        const isEditing = wizardEditingExistingKey === key;
        const row = `<div class="wizard-entry-item existing${isEditing ? ' editing' : ''}">
            <div class="wizard-entry-item-info"><strong>Universal ULB</strong>
                <span style="margin-left:6px;font-size:0.875rem">${formatBudgetWithCreditReferenceFromCredits(state.enterprise.universalULB)}/user</span></div>
            <div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="btn-sm" onclick="wizardToggleExistingEdit('${escapeInlineArg(key)}')">✏️ Edit</button><button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingULB('universal','_')">🗑 Remove</button></div></div>`;
        existingULBItems.push(isEditing ? row + `<div class="wizard-existing-edit-form">
            <div class="form-row" style="margin-bottom:8px">
                <div class="form-group"><label>Budget ($)</label>
                    <input type="number" id="wzeULBVal_universal__" min="0" step="0.01" value="${escapeHtml(creditsToDollars(state.enterprise.universalULB).toFixed(2))}"></div>
            </div>
            <div id="wzeULBErr_universal__" class="wizard-error"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingULB('universal','_')">🗑 Remove</button>
                <button type="button" class="btn-primary btn-sm" onclick="wizardSaveExistingULB('universal','_')">✓ Save</button>
            </div></div>` : row);
    }
    state.users.filter(u => u.individualULB !== null).forEach(u => {
        const key = 'ulb:user:' + u.id;
        const isEditing = wizardEditingExistingKey === key;
        const row = `<div class="wizard-entry-item existing${isEditing ? ' editing' : ''}">
            <div class="wizard-entry-item-info"><strong>${escapeHtml(u.name)}</strong>
                <span class="badge badge-warning" style="margin-left:6px">Individual</span>
                <span style="margin-left:6px;font-size:0.875rem">${formatBudgetWithCreditReferenceFromCredits(u.individualULB)}</span></div>
            <div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="btn-sm" onclick="wizardToggleExistingEdit('${escapeInlineArg(key)}')">✏️ Edit</button><button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingULB('user','${escapeInlineArg(u.id)}')">🗑 Remove</button></div></div>`;
        existingULBItems.push(isEditing ? row + `<div class="wizard-existing-edit-form">
            <div class="form-row" style="margin-bottom:8px">
                <div class="form-group"><label>Budget ($)</label>
                    <input type="number" id="wzeULBVal_user_${escapeHtml(u.id)}" min="0" step="0.01" value="${escapeHtml(creditsToDollars(u.individualULB).toFixed(2))}"></div>
            </div>
            <div id="wzeULBErr_user_${escapeHtml(u.id)}" class="wizard-error"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingULB('user','${escapeInlineArg(u.id)}')">🗑 Remove</button>
                <button type="button" class="btn-primary btn-sm" onclick="wizardSaveExistingULB('user','${escapeInlineArg(u.id)}')">✓ Save</button>
            </div></div>` : row);
    });
    state.costCenters.filter(c => c.ulb !== null).forEach(c => {
        const key = 'ulb:cc:' + c.id;
        const isEditing = wizardEditingExistingKey === key;
        const row = `<div class="wizard-entry-item existing${isEditing ? ' editing' : ''}">
            <div class="wizard-entry-item-info"><strong>${escapeHtml(c.name)}</strong>
                <span class="badge badge-info" style="margin-left:6px">Cost Center</span>
                <span style="margin-left:6px;font-size:0.875rem">${formatBudgetWithCreditReferenceFromCredits(c.ulb)}</span></div>
            <div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="btn-sm" onclick="wizardToggleExistingEdit('${escapeInlineArg(key)}')">✏️ Edit</button><button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingULB('cc','${escapeInlineArg(c.id)}')">🗑 Remove</button></div></div>`;
        existingULBItems.push(isEditing ? row + `<div class="wizard-existing-edit-form">
            <div class="form-row" style="margin-bottom:8px">
                <div class="form-group"><label>Budget ($)</label>
                    <input type="number" id="wzeULBVal_cc_${escapeHtml(c.id)}" min="0" step="0.01" value="${escapeHtml(creditsToDollars(c.ulb).toFixed(2))}"></div>
            </div>
            <div id="wzeULBErr_cc_${escapeHtml(c.id)}" class="wizard-error"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingULB('cc','${escapeInlineArg(c.id)}')">🗑 Remove</button>
                <button type="button" class="btn-primary btn-sm" onclick="wizardSaveExistingULB('cc','${escapeInlineArg(c.id)}')">✓ Save</button>
            </div></div>` : row);
    });
    const existingULBHtml = existingULBItems.length > 0
        ? `<div class="wizard-existing-section">
            <h4>Already in Simulator (${existingULBItems.length})</h4>
            <div class="wizard-entry-list">${existingULBItems.join('')}</div></div>` : '';

    return `<h3>Step 5: User-Level Budgets</h3>
        <p class="help-text" style="margin-bottom:16px">Optionally set per-user dollar caps (ULBs). These are always hard stops. Precedence: Individual &gt; Cost Center &gt; Universal. AI credit equivalents are shown for reference.</p>
        <div class="form-group" style="margin-bottom:16px">
            <label>Universal ULB — applies to all users unless overridden (leave blank for no limit)</label>
            <input type="number" id="wizardUniversalULB" placeholder="No limit" min="0" step="0.01" value="${escapeHtml(universalVal)}">
        </div>
        <div class="section-divider"></div>
        <h3 style="margin:0 0 8px">Add Specific Budget</h3>
        <form onsubmit="event.preventDefault(); wizardAddUserBudget()">
            <div class="inline-form">
                <div class="form-group"><label>Type</label>
                    <select id="wizardULBType" onchange="wizardUpdateULBTargets()">
                        <option value="individual">Individual User</option>
                        <option value="costcenter">Cost Center</option>
                    </select></div>
                <div class="form-group"><label>Target</label><select id="wizardULBTarget">${targetOpts}</select></div>
                <div class="form-group"><label>Budget ($)</label>
                    <input type="number" id="wizardULBValue" min="0" step="0.01" placeholder="e.g., 50"></div>
                <button type="submit" class="btn-primary">+ Add</button>
            </div>
            <div class="wizard-error" id="wizardULBError"></div>
        </form>
        <div id="wizardULBList">${wizardULBListHtml()}</div>
        ${existingULBHtml}`;
}

// ─── Wizard Step 6: Overage Budgets ───────────────────────────────────────────
function wizardUpdateOverageTargets() {
    const typeEl = document.getElementById('wizardOverageType');
    const targetEl = document.getElementById('wizardOverageTarget');
    if (!typeEl || !targetEl) return;
    const type = typeEl.value;
    if (type === 'org') {
        const used = new Set(wizardData.overageBudgets.orgs.map(b => b.orgName));
        const all = [
            ...state.orgs.filter(o => o.budget === null && !used.has(o.name)).map(o => o.name),
            ...wizardData.orgs.filter(o => !used.has(o.name)).map(o => o.name)
        ];
        targetEl.innerHTML = all.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    } else {
        const used = new Set(wizardData.overageBudgets.costCenters.map(b => b.ccName));
        const all = [
            ...state.costCenters.filter(cc => cc.budget === null && !used.has(cc.name)).map(cc => cc.name),
            ...wizardData.costCenters.filter(cc => !used.has(cc.name)).map(cc => cc.name)
        ];
        targetEl.innerHTML = all.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    }
}

function wizardAddOverageBudget() {
    const type = document.getElementById('wizardOverageType').value;
    const target = document.getElementById('wizardOverageTarget').value;
    const value = parseFloat(document.getElementById('wizardOverageValue').value);
    const hardStop = document.getElementById('wizardOverageHardStop').checked;
    const errEl = document.getElementById('wizardOverageError');
    if (!target) { errEl.textContent = 'Select a target.'; return; }
    if (isNaN(value) || value < 0) { errEl.textContent = 'Enter a valid budget (≥ $0).'; return; }
    if (type === 'org') {
        if (wizardData.overageBudgets.orgs.some(b => b.orgName === target)) { errEl.textContent = `"${target}" already has an overage budget.`; return; }
        wizardData.overageBudgets.orgs.push({ orgName: target, budget: value, hardStop });
    } else {
        if (wizardData.overageBudgets.costCenters.some(b => b.ccName === target)) { errEl.textContent = `"${target}" already has an overage budget.`; return; }
        wizardData.overageBudgets.costCenters.push({ ccName: target, budget: value, hardStop });
    }
    document.getElementById('wizardOverageValue').value = '';
    errEl.textContent = '';
    renderWizardOverageList();
    wizardUpdateOverageTargets();
}

function wizardRemoveOverageBudget(type, target) {
    if (type === 'org') wizardData.overageBudgets.orgs = wizardData.overageBudgets.orgs.filter(b => b.orgName !== target);
    else wizardData.overageBudgets.costCenters = wizardData.overageBudgets.costCenters.filter(b => b.ccName !== target);
    renderWizardOverageList();
    wizardUpdateOverageTargets();
}

function wizardOverageListHtml() {
    const items = [
        ...wizardData.overageBudgets.orgs.map(b => ({ type: 'org', target: b.orgName, budget: b.budget, hardStop: b.hardStop })),
        ...wizardData.overageBudgets.costCenters.map(b => ({ type: 'costcenter', target: b.ccName, budget: b.budget, hardStop: b.hardStop }))
    ];
    if (items.length === 0) return '<p class="help-text">No scoped overage budgets added yet.</p>';
    return '<div class="wizard-entry-list">' + items.map(b =>
        `<div class="wizard-entry-item"><div class="wizard-entry-item-info">
            <strong>${escapeHtml(b.target)}</strong>
            <span class="badge ${b.type === 'org' ? 'badge-info' : 'badge-warning'}" style="margin-left:6px">${b.type === 'org' ? 'Organization' : 'Cost Center'}</span>
            <span style="margin-left:6px;font-size:0.875rem">${formatBudgetWithCreditReferenceFromDollars(b.budget)} · ${b.hardStop ? 'hard stop' : 'soft stop'}</span>
        </div><button type="button" class="btn-danger btn-sm" onclick="wizardRemoveOverageBudget('${escapeInlineArg(b.type)}','${escapeInlineArg(b.target)}')">✕</button></div>`
    ).join('') + '</div>';
}

function renderWizardOverageList() {
    const el = document.getElementById('wizardOverageList');
    if (el) el.innerHTML = wizardOverageListHtml();
}

function renderWizardStepOverageBudgets() {
    const allOrgs = [...state.orgs.filter(o => o.budget === null).map(o => o.name), ...wizardData.orgs.map(o => o.name)];
    const orgOpts = allOrgs.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');

    // Existing overage budgets from state
    const existingOverageItems = [];
    // Enterprise budget is always shown (it has a current value)
    const entKey = 'overage:enterprise:_';
    const entEditing = wizardEditingExistingKey === entKey;
    const entRow = `<div class="wizard-entry-item existing${entEditing ? ' editing' : ''}">
        <div class="wizard-entry-item-info"><strong>Enterprise</strong>
            <span style="margin-left:6px;font-size:0.875rem">${formatBudgetWithCreditReferenceFromDollars(state.enterprise.enterpriseBudget)} · ${state.enterprise.enterpriseHardStop ? 'hard stop' : 'soft stop'}${state.enterprise.costCenterBudgetsIndependent ? ' · independent CC budgets' : ''}</span></div>
        <div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="btn-sm" onclick="wizardToggleExistingEdit('${escapeInlineArg(entKey)}')">✏️ Edit</button></div></div>`;
    existingOverageItems.push(entEditing ? entRow + `<div class="wizard-existing-edit-form">
        <div class="form-row" style="margin-bottom:8px">
            <div class="form-group"><label>Budget ($)</label>
                <input type="number" id="wzeOverageVal_enterprise__" min="0" step="50" value="${escapeHtml(String(state.enterprise.enterpriseBudget))}"></div>
            <div class="form-group"><label>&nbsp;</label>
                <label class="checkbox-label">
                    <input type="checkbox" id="wzeOverageHS_enterprise__" ${state.enterprise.enterpriseHardStop ? 'checked' : ''}> Hard stop</label></div>
            <div class="form-group"><label>&nbsp;</label>
                <label class="checkbox-label">
                    <input type="checkbox" id="wzeOverageIndep_enterprise__" data-bind="costCenterBudgetsIndependent" ${state.enterprise.costCenterBudgetsIndependent ? 'checked' : ''}> Cost center overage budgets are independent of enterprise budget</label></div>
        </div>
        <div id="wzeOverageErr_enterprise__" class="wizard-error"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
            <button type="button" class="btn-primary btn-sm" onclick="wizardSaveExistingOverage('enterprise','_')">✓ Save</button>
        </div></div>` : entRow);

    state.orgs.filter(o => o.budget !== null).forEach(o => {
        const key = 'overage:org:' + o.id;
        const isEditing = wizardEditingExistingKey === key;
        const row = `<div class="wizard-entry-item existing${isEditing ? ' editing' : ''}">
            <div class="wizard-entry-item-info"><strong>${escapeHtml(o.name)}</strong>
                <span class="badge badge-info" style="margin-left:6px">Organization</span>
                <span style="margin-left:6px;font-size:0.875rem">${formatBudgetWithCreditReferenceFromDollars(o.budget)} · ${o.budgetHardStop ? 'hard stop' : 'soft stop'}</span></div>
            <div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="btn-sm" onclick="wizardToggleExistingEdit('${escapeInlineArg(key)}')">✏️ Edit</button><button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingOverage('org','${escapeInlineArg(o.id)}')">🗑 Remove</button></div></div>`;
        existingOverageItems.push(isEditing ? row + `<div class="wizard-existing-edit-form">
            <div class="form-row" style="margin-bottom:8px">
                <div class="form-group"><label>Budget ($)</label>
                    <input type="number" id="wzeOverageVal_org_${escapeHtml(o.id)}" min="0" step="50" value="${escapeHtml(String(o.budget))}"></div>
                <div class="form-group"><label>&nbsp;</label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="wzeOverageHS_org_${escapeHtml(o.id)}" ${o.budgetHardStop ? 'checked' : ''}> Hard stop</label></div>
            </div>
            <div id="wzeOverageErr_org_${escapeHtml(o.id)}" class="wizard-error"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingOverage('org','${escapeInlineArg(o.id)}')">🗑 Remove</button>
                <button type="button" class="btn-primary btn-sm" onclick="wizardSaveExistingOverage('org','${escapeInlineArg(o.id)}')">✓ Save</button>
            </div></div>` : row);
    });
    state.costCenters.filter(c => c.budget !== null).forEach(c => {
        const key = 'overage:cc:' + c.id;
        const isEditing = wizardEditingExistingKey === key;
        const row = `<div class="wizard-entry-item existing${isEditing ? ' editing' : ''}">
            <div class="wizard-entry-item-info"><strong>${escapeHtml(c.name)}</strong>
                <span class="badge badge-warning" style="margin-left:6px">Cost Center</span>
                <span style="margin-left:6px;font-size:0.875rem">${formatBudgetWithCreditReferenceFromDollars(c.budget)} · ${c.budgetHardStop ? 'hard stop' : 'soft stop'}</span></div>
            <div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="btn-sm" onclick="wizardToggleExistingEdit('${escapeInlineArg(key)}')">✏️ Edit</button><button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingOverage('cc','${escapeInlineArg(c.id)}')">🗑 Remove</button></div></div>`;
        existingOverageItems.push(isEditing ? row + `<div class="wizard-existing-edit-form">
            <div class="form-row" style="margin-bottom:8px">
                <div class="form-group"><label>Budget ($)</label>
                    <input type="number" id="wzeOverageVal_cc_${escapeHtml(c.id)}" min="0" step="50" value="${escapeHtml(String(c.budget))}"></div>
                <div class="form-group"><label>&nbsp;</label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="wzeOverageHS_cc_${escapeHtml(c.id)}" ${c.budgetHardStop ? 'checked' : ''}> Hard stop</label></div>
            </div>
            <div id="wzeOverageErr_cc_${escapeHtml(c.id)}" class="wizard-error"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" class="btn-danger btn-sm" onclick="wizardDeleteExistingOverage('cc','${escapeInlineArg(c.id)}')">🗑 Remove</button>
                <button type="button" class="btn-primary btn-sm" onclick="wizardSaveExistingOverage('cc','${escapeInlineArg(c.id)}')">✓ Save</button>
            </div></div>` : row);
    });
    const existingOverageHtml = existingOverageItems.length > 0
        ? `<div class="wizard-existing-section">
            <h4>Already in Simulator (${existingOverageItems.length})</h4>
            <div class="wizard-entry-list">${existingOverageItems.join('')}</div></div>` : '';

    return `<h3>Step 6: Overage Budgets</h3>
        <p class="help-text" style="margin-bottom:16px">Configure metered dollar budgets that cap $0.01/credit charges once the credit pool is exhausted. AI credit equivalents are shown for reference.</p>
        <div class="form-row" style="margin-bottom:16px">
            <div class="form-group"><label>Enterprise metered budget ($)</label>
                <input type="number" id="wizardEntBudget" value="${wizardData.overageBudgets.enterpriseBudget}" min="0" step="50">
                <p class="help-text">Reference: ${formatAICreditReference(meteredCreditsFromBudget(wizardData.overageBudgets.enterpriseBudget))}</p></div>
            <div class="form-group"><label>&nbsp;</label>
                <label class="checkbox-label">
                    <input type="checkbox" id="wizardEntHardStop" ${wizardData.overageBudgets.enterpriseHardStop ? 'checked' : ''}>
                    Hard stop when exhausted
                </label></div>
            <div class="form-group"><label>&nbsp;</label>
                <label class="checkbox-label">
                    <input type="checkbox" id="wizardEntIndependent" data-bind="costCenterBudgetsIndependent" ${wizardData.overageBudgets.costCenterBudgetsIndependent ? 'checked' : ''}>
                    Cost center overage budgets are independent of enterprise budget
                </label></div>
        </div>
        <div class="section-divider"></div>
        <h3 style="margin:0 0 8px">Add Scoped Overage Budget</h3>
        <form onsubmit="event.preventDefault(); wizardAddOverageBudget()">
            <div class="inline-form">
                <div class="form-group"><label>Type</label>
                    <select id="wizardOverageType" onchange="wizardUpdateOverageTargets()">
                        <option value="org">Organization</option>
                        <option value="costcenter">Cost Center</option>
                    </select></div>
                <div class="form-group"><label>Target</label><select id="wizardOverageTarget">${orgOpts}</select></div>
                <div class="form-group"><label>Budget ($)</label>
                    <input type="number" id="wizardOverageValue" min="0" step="50" placeholder="e.g., 500"></div>
                <div class="form-group"><label>&nbsp;</label>
                    <label class="checkbox-label"><input type="checkbox" id="wizardOverageHardStop" checked> Hard stop</label></div>
                <button type="submit" class="btn-primary">+ Add</button>
            </div>
            <div class="wizard-error" id="wizardOverageError"></div>
        </form>
        <div id="wizardOverageList">${wizardOverageListHtml()}</div>
        ${existingOverageHtml}`;
}

// ─── Wizard Step 7: Review ────────────────────────────────────────────────────
function renderWizardStepReview() {
    const sections = [];

    if (wizardData.orgs.length > 0) {
        sections.push(`<div class="wizard-review-section"><h3>🏛️ Organizations (${wizardData.orgs.length})</h3>
            ${wizardData.orgs.map(o => `<div class="wizard-review-item">${escapeHtml(o.name)}</div>`).join('')}</div>`);
    }
    if (wizardData.teams.length > 0) {
        sections.push(`<div class="wizard-review-section"><h3>👥 Enterprise Teams (${wizardData.teams.length})</h3>
            ${wizardData.teams.map(t => `<div class="wizard-review-item">${escapeHtml(t.name)}</div>`).join('')}</div>`);
    }
    if (wizardData.costCenters.length > 0) {
        sections.push(`<div class="wizard-review-section"><h3>📂 Cost Centers (${wizardData.costCenters.length})</h3>
            ${wizardData.costCenters.map(cc => {
                const parts = [];
                if (cc.teamNames && cc.teamNames.length > 0) parts.push(`Teams: ${cc.teamNames.join(', ')}`);
                if (cc.orgNames && cc.orgNames.length > 0) parts.push(`Orgs: ${cc.orgNames.join(', ')}`);
                return `<div class="wizard-review-item"><strong>${escapeHtml(cc.name)}</strong>
                    ${parts.length > 0 ? `<div class="help-text">${escapeHtml(parts.join(' · '))}</div>` : ''}</div>`;
            }).join('')}</div>`);
    }
    if (wizardData.users.length > 0) {
        sections.push(`<div class="wizard-review-section"><h3>👤 Users (${wizardData.users.length})</h3>
            ${wizardData.users.map(u => {
                const meta = [u.license, u.ccName && `CC: ${u.ccName}`, u.orgName && `Org: ${u.orgName}`, u.teamName && `Team: ${u.teamName}`].filter(Boolean).join(' · ');
                return `<div class="wizard-review-item"><strong>${escapeHtml(u.name)}</strong>
                    <div class="help-text">${escapeHtml(meta)}</div></div>`;
            }).join('')}</div>`);
    }
    const ulbTotal = wizardData.userBudgets.individual.length + wizardData.userBudgets.costCenter.length;
    const hasUniversal = wizardData.userBudgets.universalULB !== '' && wizardData.userBudgets.universalULB !== null;
    if (hasUniversal || ulbTotal > 0) {
        let ulbHtml = '';
        if (hasUniversal) {
            const universalDollars = parseFloat(wizardData.userBudgets.universalULB);
            if (Number.isFinite(universalDollars) && universalDollars >= 0) {
                ulbHtml += `<div class="wizard-review-item"><strong>Universal:</strong> ${formatBudgetWithCreditReferenceFromCredits(dollarsToCredits(universalDollars))}/user</div>`;
            }
        }
        wizardData.userBudgets.costCenter.forEach(b => {
            ulbHtml += `<div class="wizard-review-item"><strong>${escapeHtml(b.ccName)}</strong> (Cost Center): ${formatBudgetWithCreditReferenceFromCredits(b.budget)}</div>`;
        });
        wizardData.userBudgets.individual.forEach(b => {
            ulbHtml += `<div class="wizard-review-item"><strong>${escapeHtml(b.userName)}</strong> (Individual): ${formatBudgetWithCreditReferenceFromCredits(b.budget)}</div>`;
        });
        sections.push(`<div class="wizard-review-section"><h3>💰 User-Level Budgets</h3>${ulbHtml}</div>`);
    }
    const entBudgetChanged = wizardData.overageBudgets.enterpriseBudget !== state.enterprise.enterpriseBudget
        || wizardData.overageBudgets.enterpriseHardStop !== state.enterprise.enterpriseHardStop;
    const entIndependenceChanged = wizardData.overageBudgets.costCenterBudgetsIndependent !== state.enterprise.costCenterBudgetsIndependent;
    const hasOvBudgets = wizardData.overageBudgets.orgs.length > 0 || wizardData.overageBudgets.costCenters.length > 0;
    if (entBudgetChanged || entIndependenceChanged || hasOvBudgets) {
        let ovHtml = '';
        if (entBudgetChanged) ovHtml += `<div class="wizard-review-item"><strong>Enterprise:</strong> ${formatBudgetWithCreditReferenceFromDollars(wizardData.overageBudgets.enterpriseBudget)} ${wizardData.overageBudgets.enterpriseHardStop ? '(hard stop)' : '(soft stop)'}</div>`;
        if (entBudgetChanged || entIndependenceChanged) ovHtml += `<div class="wizard-review-item"><strong>Cost center budget behavior:</strong> ${wizardData.overageBudgets.costCenterBudgetsIndependent ? 'Independent of enterprise budget' : 'Uses enterprise budget'}</div>`;
        wizardData.overageBudgets.orgs.forEach(b => {
            ovHtml += `<div class="wizard-review-item"><strong>${escapeHtml(b.orgName)}</strong> (Org): ${formatBudgetWithCreditReferenceFromDollars(b.budget)} ${b.hardStop ? '(hard stop)' : '(soft stop)'}</div>`;
        });
        wizardData.overageBudgets.costCenters.forEach(b => {
            ovHtml += `<div class="wizard-review-item"><strong>${escapeHtml(b.ccName)}</strong> (CC): ${formatBudgetWithCreditReferenceFromDollars(b.budget)} ${b.hardStop ? '(hard stop)' : '(soft stop)'}</div>`;
        });
        sections.push(`<div class="wizard-review-section"><h3>💳 Overage Budgets</h3>${ovHtml}</div>`);
    }

    if (sections.length === 0) {
        return `<h3>Step 7: Review &amp; Confirm</h3>
            <div class="empty-state" style="padding:32px">
                <p>Nothing to create yet.</p>
                <p style="margin-top:8px">Go back and add organizations, teams, cost centers, users, or budgets.</p>
            </div>`;
    }
    return `<h3>Step 7: Review &amp; Confirm</h3>
        <p class="help-text" style="margin-bottom:16px">Review everything that will be created. Go back to make changes, or click <strong>Confirm &amp; Create</strong> to commit.</p>
        ${sections.join('')}`;
}

// ─── Wizard: Confirm & Create ─────────────────────────────────────────────────
function confirmWizard() {
    if (wizardDone) return;
    captureWizardStepValues(5);

    const skipped = [];
    let idSeq = 0;
    const uid = () => `_w${Date.now()}${idSeq++}_${Math.random().toString(36).slice(2, 7)}`;

    // 1. Organizations
    wizardData.orgs.forEach(o => {
        if (state.orgs.some(e => e.name === o.name)) { skipped.push(`Organization "${o.name}" already exists — skipped.`); return; }
        state.orgs.push({ id: 'org' + uid(), name: o.name, budget: null, budgetHardStop: true });
    });

    // 2. Teams
    wizardData.teams.forEach(t => {
        if (state.teams.some(e => e.name === t.name)) { skipped.push(`Team "${t.name}" already exists — skipped.`); return; }
        state.teams.push({ id: 'team' + uid(), name: t.name });
    });

    // 3. Cost Centers
    wizardData.costCenters.forEach(cc => {
        if (state.costCenters.some(e => e.name === cc.name)) { skipped.push(`Cost center "${cc.name}" already exists — skipped.`); return; }
        const teamIds = (cc.teamNames || []).map(n => { const t = state.teams.find(t => t.name === n); return t ? t.id : null; }).filter(Boolean);
        const orgIds = (cc.orgNames || []).map(n => { const o = state.orgs.find(o => o.name === n); return o ? o.id : null; }).filter(Boolean);
        state.costCenters.push({
            id: 'cc' + uid(), name: cc.name, teamIds, orgIds, userIds: [],
            teamId: teamIds[0] || null, poolEnabled: false, overagesAllowed: true,
            budget: null, budgetHardStop: true, ulb: null
        });
    });

    // 4. Users
    wizardData.users.forEach(u => {
        if (state.users.some(e => e.name === u.name)) { skipped.push(`User "${u.name}" already exists — skipped.`); return; }
        const cc = u.ccName ? state.costCenters.find(c => c.name === u.ccName) : null;
        const org = u.orgName ? state.orgs.find(o => o.name === u.orgName) : null;
        const team = u.teamName ? state.teams.find(t => t.name === u.teamName) : null;
        state.users.push({
            id: 'user' + uid(), name: u.name,
            costCenterId: cc ? cc.id : null,
            orgId: org ? org.id : null,
            teamId: team ? team.id : null,
            license: u.license || 'business',
            individualULB: null
        });
    });

    // 5. User-level budgets
    const ulbVal = wizardData.userBudgets.universalULB;
    if (ulbVal !== '' && ulbVal !== null) {
        const parsedDollars = parseFloat(ulbVal);
        if (Number.isFinite(parsedDollars) && parsedDollars >= 0) state.enterprise.universalULB = dollarsToCredits(parsedDollars);
    }
    wizardData.userBudgets.individual.forEach(b => {
        const user = state.users.find(u => u.name === b.userName);
        if (user) user.individualULB = b.budget;
        else skipped.push(`User "${b.userName}" not found for ULB — skipped.`);
    });
    wizardData.userBudgets.costCenter.forEach(b => {
        const cc = state.costCenters.find(c => c.name === b.ccName);
        if (cc) cc.ulb = b.budget;
        else skipped.push(`Cost center "${b.ccName}" not found for ULB — skipped.`);
    });

    // 6. Overage budgets
    state.enterprise.enterpriseBudget = wizardData.overageBudgets.enterpriseBudget;
    state.enterprise.enterpriseHardStop = wizardData.overageBudgets.enterpriseHardStop;
    setCostCenterBudgetsIndependent(wizardData.overageBudgets.costCenterBudgetsIndependent);
    wizardData.overageBudgets.orgs.forEach(b => {
        const org = state.orgs.find(o => o.name === b.orgName);
        if (org) { org.budget = b.budget; org.budgetHardStop = b.hardStop; }
        else skipped.push(`Organization "${b.orgName}" not found for overage budget — skipped.`);
    });
    wizardData.overageBudgets.costCenters.forEach(b => {
        const cc = state.costCenters.find(c => c.name === b.ccName);
        if (cc) { cc.budget = b.budget; cc.budgetHardStop = b.hardStop; }
        else skipped.push(`Cost center "${b.ccName}" not found for overage budget — skipped.`);
    });

    recalcAutoSeats();
    saveState();
    renderAll();

    wizardDone = true;
    const skippedHtml = skipped.length > 0
        ? `<div style="margin-top:16px;background:rgba(210,153,34,0.1);border:1px solid var(--color-warning);border-radius:var(--radius);padding:12px;text-align:left">
            <strong style="color:var(--color-warning)">⚠️ ${skipped.length} item(s) skipped (already existed):</strong>
            <ul style="margin-top:6px;padding-left:18px;font-size:0.8rem">${skipped.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
           </div>`
        : '';
    const createdParts = [
        wizardData.orgs.length > 0 && `${wizardData.orgs.length} organization(s)`,
        wizardData.teams.length > 0 && `${wizardData.teams.length} team(s)`,
        wizardData.costCenters.length > 0 && `${wizardData.costCenters.length} cost center(s)`,
        wizardData.users.length > 0 && `${wizardData.users.length} user(s)`,
        (wizardData.userBudgets.individual.length + wizardData.userBudgets.costCenter.length > 0) && 'user-level budgets',
        (wizardData.overageBudgets.orgs.length + wizardData.overageBudgets.costCenters.length > 0) && 'overage budgets'
    ].filter(Boolean);

    document.getElementById('wizardBody').innerHTML = `
        <div class="wizard-success">
            <div class="wizard-success-icon">✅</div>
            <h2 style="margin-bottom:8px">Setup Complete!</h2>
            <p style="color:var(--color-text-muted);margin-bottom:16px">Your configuration has been created and saved.</p>
            ${createdParts.length > 0 ? `<p style="font-size:0.875rem;margin-bottom:12px">Created: ${createdParts.join(', ')}.</p>` : ''}
            <p class="help-text" style="max-width:440px;margin:0 auto">
               💡 <strong>Next steps:</strong> Use <strong>⚙️ Settings</strong> to enable AI credit pool reservations for your cost centers,
               then head to <strong>📊 Dashboard</strong> to model usage patterns and verify your budget setup.
            </p>
            ${skippedHtml}
        </div>`;
    renderWizardStepper();
    renderWizardFooter();
}

renderAll();

// Blink the wizard button twice in orange on page load to make it visible
(function () {
    const btn = document.getElementById('wizardOpenBtn');
    if (!btn) return;
    btn.classList.add('wizard-btn-blink');
    btn.addEventListener('animationend', function onEnd() {
        btn.classList.remove('wizard-btn-blink');
        btn.removeEventListener('animationend', onEnd);
    });
})();
