import { z } from 'zod';
const namePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
function hasAtMostCodePoints(value, maximum) {
    return Array.from(value).length <= maximum;
}
function boundedCodePointString(maximum) {
    return z
        .string()
        .min(1)
        .refine((value) => hasAtMostCodePoints(value, maximum), {
        message: `Must contain at most ${String(maximum)} Unicode code points`,
    })
        .meta({ maxLength: maximum });
}
function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    }
    catch {
        return false;
    }
}
const httpUrl = z
    .string()
    .min(1)
    .refine(isHttpUrl, { message: 'Expected an absolute HTTP or HTTPS URL' })
    .meta({
    format: 'uri',
    pattern: '^[Hh][Tt][Tt][Pp][Ss]?:',
});
const pageSchema = z
    .strictObject({
    name: z.string().regex(namePattern),
    url: httpUrl.optional(),
    path: z.string().startsWith('/').optional(),
    readySelector: boundedCodePointString(500).optional(),
    consoleIgnore: z
        .array(boundedCodePointString(500))
        .max(50)
        .default([])
        .optional(),
})
    .meta({
    oneOf: [
        { required: ['url'], not: { required: ['path'] } },
        { required: ['path'], not: { required: ['url'] } },
    ],
});
const viewportSchema = z.strictObject({
    name: z.string().regex(namePattern),
    width: z.number().int().min(1).max(10_000),
    height: z.number().int().min(1).max(10_000),
    deviceScaleFactor: z.number().gt(0).max(4).default(1).optional(),
});
const outputSchema = z.strictObject({
    dir: z.string().min(1).default('artifacts/viewport-sentinel').optional(),
    formats: z
        .array(z.enum(['json', 'sarif']))
        .min(1)
        .max(2)
        .meta({ uniqueItems: true })
        .default(['json', 'sarif'])
        .optional(),
});
export const ConfigInputSchema = z
    .strictObject({
    $schema: z.string().min(1).optional(),
    version: z.literal(1).meta({ type: 'integer' }),
    baseUrl: httpUrl.optional(),
    pages: z.array(pageSchema).min(1).max(50),
    viewports: z.array(viewportSchema).min(1).max(12),
    timeoutMs: z
        .number()
        .int()
        .min(1_000)
        .max(60_000)
        .default(10_000)
        .optional(),
    output: outputSchema
        .default({
        dir: 'artifacts/viewport-sentinel',
        formats: ['json', 'sarif'],
    })
        .optional(),
})
    .superRefine((config, context) => {
    if (config.pages.length > 50) {
        context.addIssue({
            code: 'custom',
            path: ['pages'],
            message: 'Must contain at most 50 pages',
        });
    }
    if (config.viewports.length > 12) {
        context.addIssue({
            code: 'custom',
            path: ['viewports'],
            message: 'Must contain at most 12 viewports',
        });
    }
    const pageNames = new Set();
    for (const [index, page] of config.pages.entries()) {
        if (pageNames.has(page.name)) {
            context.addIssue({
                code: 'custom',
                path: ['pages', index, 'name'],
                message: 'Page names must be unique',
            });
        }
        pageNames.add(page.name);
        if ((page.url === undefined) === (page.path === undefined)) {
            context.addIssue({
                code: 'custom',
                path: ['pages', index],
                message: 'Page must define exactly one of url or path',
            });
        }
        if (page.path !== undefined && config.baseUrl === undefined) {
            context.addIssue({
                code: 'custom',
                path: ['baseUrl'],
                message: 'baseUrl is required when a page uses path',
            });
        }
    }
    const viewportNames = new Set();
    for (const [index, viewport] of config.viewports.entries()) {
        if (viewportNames.has(viewport.name)) {
            context.addIssue({
                code: 'custom',
                path: ['viewports', index, 'name'],
                message: 'Viewport names must be unique',
            });
        }
        viewportNames.add(viewport.name);
    }
    const formats = config.output?.formats ?? ['json', 'sarif'];
    if (formats.length === 0) {
        context.addIssue({
            code: 'custom',
            path: ['output', 'formats'],
            message: 'formats must not be empty',
        });
    }
    if (new Set(formats).size !== formats.length) {
        context.addIssue({
            code: 'custom',
            path: ['output', 'formats'],
            message: 'formats must be unique',
        });
    }
})
    .meta({
    allOf: [
        {
            if: {
                properties: {
                    pages: {
                        contains: { required: ['path'] },
                    },
                },
                required: ['pages'],
            },
            then: { required: ['baseUrl'] },
        },
    ],
});
//# sourceMappingURL=schema.js.map