import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSimulator } from './load-simulator.mjs';

function snapshotState(sim) {
    return JSON.parse(JSON.stringify(sim.getState()));
}

test('sample loading confirms before replacing settings-only configuration', async () => {
    const sim = loadSimulator();
    const existing = sim.call('defaultState');
    existing.enterprise.businessSeats = 5;
    sim.setState(existing);
    const expectedState = snapshotState(sim);

    let confirmation = '';
    let fetchCalled = false;
    sim.context.confirm = message => {
        confirmation = message;
        return false;
    };
    sim.context.fetch = async () => {
        fetchCalled = true;
        throw new Error('fetch should not run after canceling replacement');
    };

    await sim.call('loadSampleConfig');

    assert.equal(confirmation, 'Replace the current configuration with sample data?');
    assert.equal(fetchCalled, false);
    assert.deepEqual(snapshotState(sim), expectedState);
});
