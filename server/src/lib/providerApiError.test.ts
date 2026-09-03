import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderApiError, parseProviderMessage } from './providerApiError.js';

void test('parseProviderMessage reads both providers own error shapes', () => {
  assert.equal(
    parseProviderMessage('{"errors":[{"message":"project: Not a recognized ID","help":"..."}]}'),
    'project: Not a recognized ID',
  );
  assert.equal(parseProviderMessage('{"errors":[{"message":"a"},{"message":"b"}]}'), 'a · b');
  assert.equal(parseProviderMessage('{"error":{"code":"ErrorAccessDenied","message":"Access is denied."}}'), 'Access is denied.');
  // A proxy's HTML error page, or an empty body — must not end up in a toast.
  assert.equal(parseProviderMessage('<html><body>502 Bad Gateway</body></html>'), null);
  assert.equal(parseProviderMessage(''), null);
  assert.equal(parseProviderMessage('{"errors":[]}'), null);
});

void test('parseProviderMessage clamps a runaway message', () => {
  const msg = parseProviderMessage(JSON.stringify({ errors: [{ message: 'x'.repeat(500) }] }));
  assert.equal(msg?.length, 300);
  assert.ok(msg?.endsWith('…'));
});

void test('a 403 explains it is a permission, and carries Asanas own words', () => {
  const err = new ProviderApiError('Asana', 403, '/tasks', 'user not authorized to access project', '{}');
  assert.equal(err.httpStatus, 403);
  assert.match(err.userMessage, /don't have permission/);
  assert.match(err.userMessage, /user not authorized to access project/);
  assert.match(err.userMessage, /edit access/);
});

/// A provider 401 must not reach the client as a 401 — that status means
/// "your session with this app expired" to the frontend. See httpStatus.
void test('a provider 401 becomes a 502 and says to reconnect', () => {
  const err = new ProviderApiError('Asana', 401, '/tasks', null, '');
  assert.equal(err.httpStatus, 502);
  assert.match(err.userMessage, /reconnect Asana in Settings/);
});

void test('a provider 5xx reads as the provider being down, not as a bug here', () => {
  const err = new ProviderApiError('Outlook', 503, '/me/events', null, '');
  assert.equal(err.httpStatus, 502);
  assert.match(err.userMessage, /Outlook is having trouble right now \(503\)/);
});

void test('rate limiting and not-found keep their own status', () => {
  assert.equal(new ProviderApiError('Asana', 429, '/tasks', null, '').httpStatus, 429);
  assert.equal(new ProviderApiError('Asana', 404, '/tasks/1', null, '').httpStatus, 404);
});
