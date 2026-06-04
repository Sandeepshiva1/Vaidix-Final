import { interpolate, PromptInterpolationError } from '../src/server/prompts/interpolate';

try {
  interpolate(
    'Hello {{DOMAIN_NAME}}, today we discuss {{NONEXISTENT_PLACEHOLDER}}.',
    { DOMAIN_NAME: 'ophthalmology' },
    { promptId: 'test', domain: 'ophthalmology' },
  );
  console.error('FAIL: should have thrown');
  process.exit(1);
} catch (err) {
  if (err instanceof PromptInterpolationError) {
    console.log('OK — missing placeholder threw correctly:');
    console.log(' ', err.message);
    console.log('  missing:', err.missing);
  } else {
    console.error('FAIL: wrong error type:', err);
    process.exit(1);
  }
}
