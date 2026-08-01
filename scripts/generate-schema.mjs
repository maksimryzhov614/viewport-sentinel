import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { ConfigInputSchema } from '../dist/config/schema.js';

const schema = z.toJSONSchema(ConfigInputSchema, {
  target: 'draft-2020-12',
});
schema.$id =
  'https://github.com/maksimryzhov614/viewport-sentinel/config.schema.json';

await writeFile('config.schema.json', `${JSON.stringify(schema, null, 2)}\n`);
