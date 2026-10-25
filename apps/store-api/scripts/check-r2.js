// Read-only connectivity/metadata diagnostic; never prints credentials or signed URLs.
import { loadR2Config } from '../src/r2/config.js';
import { R2Provider } from '../src/r2/provider.js';

const config = loadR2Config();
if (!config.configured) {
  console.error('R2 configuration required:', config.errors.join(', '));
  process.exitCode = 1;
} else {
  try {
    const scan = await new R2Provider({ config }).scan();
    const statuses = scan.models.reduce((counts, model) => ({ ...counts, [model.status]: (counts[model.status] || 0) + 1 }), {});
    console.log(JSON.stringify({ readOnly: true, objects: scan.objects.length, folders: scan.folders.length, models: scan.models.length, statuses }));
  } catch (error) {
    console.error('R2 check failed:', /^[A-Z][A-Z0-9_]+$/.test(error.code || '') ? error.code : 'R2_CHECK_FAILED');
    process.exitCode = 1;
  }
}
