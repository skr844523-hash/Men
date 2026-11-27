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

test('checkContentSafety blocks harmful text and personal phone/ID leaks', () => {
  assert.equal(checkContentSafety('محتوى فضفضة هادئ وطبيعي جدًا').safe, true);
  assert.equal(checkContentSafety('رقمي هو 01012345678 تواصل معي').safe, false);
  assert.equal(checkContentSafety('سأقتلك غدا').safe, false);
});

test('sanitizeMediaUrl blocks javascript: and data: XSS vectors', () => {
  assert.equal(sanitizeMediaUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeMediaUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeMediaUrl('//evil.com/x.png'), null);
  assert.equal(sanitizeMediaUrl('/uploads/abc.png'), '/uploads/abc.png');
  assert.equal(sanitizeMediaUrl('https://example.com/pic.jpg'), 'https://example.com/pic.jpg');
});
