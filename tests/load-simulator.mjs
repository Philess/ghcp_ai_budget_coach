// Loads the simulator script embedded in simulator/index.html into a sandboxed
// context with a minimal DOM stub, so the simulation engine can be unit tested.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const simulatorPath = join(here, '..', 'simulator', 'index.html');

function extractScript(html) {
    const match = html.match(/<script>([\s\S]*)<\/script>/);
    if (!match) throw new Error('No inline script found in simulator/index.html');
    return match[1];
}

function createElement() {
    return {
        style: {},
        dataset: {},
        value: '',
        textContent: '',
        innerHTML: '',
        hidden: false,
        checked: false,
        files: [],
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        addEventListener() {},
        removeEventListener() {},
        appendChild() {},
        remove() {},
        setAttribute() {},
        getAttribute() { return null; },
        closest() { return null; },
        focus() {},
        click() {},
        querySelector() { return createElement(); },
        querySelectorAll() { return []; }
    };
}

function createDocumentStub() {
    return {
        getElementById() { return createElement(); },
        querySelector() { return createElement(); },
        querySelectorAll() { return []; },
        createElement() { return createElement(); },
        addEventListener() {},
        body: createElement()
    };
}

function createLocalStorageStub() {
    const store = new Map();
    return {
        getItem(key) { return store.has(key) ? store.get(key) : null; },
        setItem(key, value) { store.set(key, String(value)); },
        removeItem(key) { store.delete(key); },
        clear() { store.clear(); }
    };
}

// Returns a sandboxed simulator instance. Each call gives a fresh, isolated one.
export function loadSimulator() {
    const sandbox = {
        document: createDocumentStub(),
        localStorage: createLocalStorageStub(),
        console,
        setTimeout,
        clearTimeout,
        URL: globalThis.URL,
        Blob: globalThis.Blob,
        FileReader: globalThis.FileReader
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    const context = vm.createContext(sandbox);
    vm.runInContext(extractScript(readFileSync(simulatorPath, 'utf8')), context);

    // `state` is a top-level `let`, so it lives in the context's lexical scope and
    // is only reachable by evaluating code inside that same context.
    const getState = vm.runInContext('() => state', context);
    const setState = vm.runInContext('(next) => { state = next; }', context);

    return { context, getState, setState, call: (name, ...args) => context[name](...args) };
}
