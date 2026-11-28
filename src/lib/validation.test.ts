import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkContentSafety,
  checkMinimumAge,
  sanitizeMediaUrl,
  validateEmail,
  validatePassword,
  validatePhone,
  validateUsername,
} from './validation';

test('validateUsername enforces format and reserved handles', () => {
  assert.equal(validateUsername('@Nour_22').valid, true);
  assert.equal(validateUsername('@Nour_22').value, 'nour_22');
  assert.equal(validateUsername('ab').valid, false);
  assert.equal(validateUsername('admin').valid, false);
  assert.equal(validateUsername('user name!').valid, false);
});

test('checkMinimumAge verifies 13+ restriction deterministically', () => {
  const refDate = new Date('2026-11-26T00:00:00Z');
  assert.equal(checkMinimumAge('2013-11-26', 13, refDate).valid, true);
  assert.equal(checkMinimumAge('2013-11-27', 13, refDate).valid, false);
  assert.equal(checkMinimumAge('2000-05-10', 13, refDate).age, 26);
  assert.equal(checkMinimumAge('invalid-date', 13, refDate).valid, false);
});

test('email, phone, and password validators work accurately', () => {
  assert.equal(validateEmail('test@meen.app'), true);
  assert.equal(validateEmail('bad-email'), false);
  assert.equal(validatePhone('+201012345678'), true);
  assert.equal(validatePhone('123'), false);
  assert.equal(validatePassword('1234567').valid, false);
  assert.equal(validatePassword('StrongPass99').valid, true);
});

test('validatePassword requires 10+ chars, two character classes, and no obvious guess', () => {
  assert.equal(validatePassword('short1!A').valid, false);
  assert.equal(validatePassword('alllowercaseletters').valid, false);
  assert.equal(validatePassword('1234567890123').valid, false);
  assert.equal(validatePassword('password123').valid, false);
  assert.equal(validatePassword('Mohamed12345').valid, false);
  assert.equal(validatePassword('Nour22#Secret1', { username: 'nour_22' }).valid, false);
  assert.equal(validatePassword('sasa#Secret2026', { email: 'sasa@gmail.com' }).valid, false);
  assert.equal(validatePassword('Meen#Test2026x', { username: 'nour_22', email: 'nour@meen.app' }).valid, true);
});

test('checkContentSafety blocks harmful text and personal phone/ID leaks', () => {
  assert.equal(checkContentSafety('محتوى فضفضة هادئ وطبيعي جدًا').safe, true);
  assert.equal(checkContentSafety('رقمي هو 01012345678 تواصل معي').safe, false);
  assert.equal(checkContentSafety('سأقتلك غدا').safe, false);
});

test('sanitizeMediaUrl blocks javascript:, data:, and third-party tracking hosts', () => {
  assert.equal(sanitizeMediaUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeMediaUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeMediaUrl('//evil.com/x.png'), null);
  assert.equal(sanitizeMediaUrl('https://evil.example/track.gif'), null);
  assert.equal(sanitizeMediaUrl('http://i.ibb.co/x/pic.jpg'), null);
  assert.equal(sanitizeMediaUrl('/uploads/abc.png'), '/uploads/abc.png');
  assert.equal(sanitizeMediaUrl('/api/media/8f1c0d2e-0000-4000-8000-000000000000'), '/api/media/8f1c0d2e-0000-4000-8000-000000000000');
  assert.equal(sanitizeMediaUrl('https://i.ibb.co/3mrkTFrz/4fdccb2633f8.jpg'), 'https://i.ibb.co/3mrkTFrz/4fdccb2633f8.jpg');
  assert.equal(
    sanitizeMediaUrl('https://lh3.googleusercontent.com/a/abc'),
    'https://lh3.googleusercontent.com/a/abc'
  );
});
