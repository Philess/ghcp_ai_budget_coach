import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNodeJunit } from './reporting/normalize-node-junit.mjs';

test('normalizes Node JUnit output into a counted test suite', () => {
    const normalized = normalizeNodeJunit(`
<testsuites>
  <testcase name="passes" time="0.1" classname="test"/>
  <testcase name="fails" time="0.2" classname="test">
    <failure type="testCodeFailure" message="expected true">stack</failure>
  </testcase>
  <testcase name="skips" time="0" classname="test">
    <skipped/>
  </testcase>
</testsuites>`);

    assert.match(normalized, /<testsuites tests="3" failures="1" skipped="1" errors="0" time="0\.300000">/);
    assert.match(normalized, /<testsuite name="Node unit tests" tests="3"/);
    assert.match(normalized, /<failure type="testCodeFailure"/);
});

test('rejects an empty Node JUnit report', () => {
    assert.throws(
        () => normalizeNodeJunit('<testsuites></testsuites>'),
        /contains no test cases/
    );
});
