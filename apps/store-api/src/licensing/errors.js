export function licenseError(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

export function uuid(value, name = 'INVALID_ID') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw licenseError(name);
  }
  return value.toLowerCase();
}

export function objectBody(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !fields.includes(key))) throw licenseError('INVALID_REQUEST');
  return value;
}
